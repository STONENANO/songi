/**
 * Browser end-to-end test (mock providers). Requires Playwright and a running
 * dev server started with mock settings, e.g.:
 *   MOCK_LLM=1 MOCK_KIE=1 MOCK_SHOPIFY=1 MOCK_KIE_DELAY_MS=1500 npm run dev
 *   npm run test:e2e
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.E2E_BASE_URL || "http://localhost:4747";
const SHOTS = process.env.E2E_SCREENSHOTS || "";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

  // 1. Quiz
  await page.goto(`${BASE}/create`);
  await page.fill('input[placeholder="Linda"]', "Linda");
  await page.click('button.chip:has-text("Mom")');
  await page.click('button.chip:has-text("Birthday")');
  await page.click('button:has-text("Continue")');
  await page.fill("textarea", "Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip. Her happy place is the lake house in Michigan.");
  await page.click('button:has-text("Continue")');
  await page.click('button.chip:has-text("Country")');
  await page.click('button.chip:has-text("Female")');
  await page.click('button.chip:has-text("Heartfelt")');
  await page.click('button:has-text("Continue")');
  await page.click('button:has-text("Write my song")');
  await page.waitForURL(/\/r\//);
  const songUrl = page.url();
  const id = songUrl.split("/r/")[1];

  // 2. Verified lyrics, then record
  await page.waitForSelector('button:has-text("Sing it"):not([disabled])', { timeout: 60000 });
  assert.ok(await page.isVisible("text=checked"), "draft marked checked");
  await shot("e2e-1-lyrics");
  await page.click('button:has-text("Sing it")');
  await page.waitForSelector("text=versions. Pick the one", { timeout: 120000 });
  await shot("e2e-2-gallery");

  // 3. Three versions with private, signed preview URLs; nothing exposes full files
  const srcs = await page.$$eval("audio", (as) => as.map((a) => a.getAttribute("src")));
  assert.equal(srcs.length, 3, "three versions offered");
  assert.ok(srcs.every((s) => s.startsWith("/api/media/")));
  const html = await page.content();
  assert.ok(!html.includes("full.mp3") && !html.includes("file://"), "no storage keys in the page");
  const api = await (await page.request.get(`${BASE}/api/requests/${id}`)).json();
  assert.ok(api.candidates.every((c) => c.downloadUrl === null), "no full URLs before payment");
  const range = await page.request.get(`${BASE}${srcs[0]}`, { headers: { Range: "bytes=0-1023" } });
  assert.equal(range.status(), 206);

  // 4. Another browser (no project cookie) is refused
  const stranger = await browser.newContext();
  assert.equal((await stranger.request.get(`${BASE}/api/requests/${id}`)).status(), 403);
  assert.equal((await stranger.request.post(`${BASE}/api/requests/${id}/checkout`, { data: { versionId: api.candidates[0].id } })).status(), 403);
  await stranger.close();

  // 5. Select the second version (persists across reload), buy it
  const choose = page.locator('button:has-text("Choose this version")');
  await choose.nth(1).click();
  await page.waitForSelector('[aria-checked="true"]');
  await page.reload();
  await page.waitForSelector('[aria-checked="true"]');
  const chosenId = (await (await page.request.get(`${BASE}/api/requests/${id}`)).json()).candidates.find((c) => c.selected).id;
  assert.equal(chosenId, api.candidates[1].id, "selection persisted");
  await page.click('button:has-text("Get the full song")');
  await page.waitForURL(/\/checkout\/mock\//);
  await shot("e2e-3-checkout");
  await page.click('button:has-text("Pay (test)")');
  await page.waitForURL(songUrl, { timeout: 30000 });
  await page.waitForSelector('a:has-text("Download MP3")', { timeout: 30000 });
  await shot("e2e-4-purchased");

  // 6. Only the purchased version unlocks; download is an attachment; delivery link works
  const after = await (await page.request.get(`${BASE}/api/requests/${id}`)).json();
  assert.equal(after.status, "purchased");
  const unlocked = after.candidates.filter((c) => c.downloadUrl);
  assert.deepEqual(unlocked.map((c) => c.id), [chosenId]);
  const dl = await page.request.get(`${BASE}${unlocked[0].downloadUrl}`);
  assert.equal(dl.status(), 200);
  assert.match(dl.headers()["content-disposition"] || "", /attachment/);
  const delivery = await page.request.get(`${BASE}${after.order.deliveryLink}`);
  assert.equal(delivery.status(), 200);

  assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
  console.log(`E2E passed for project ${id}`);
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
