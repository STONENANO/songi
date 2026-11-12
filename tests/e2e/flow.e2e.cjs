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

  // 1. Story quiz (one question per screen)
  await page.goto(`${BASE}/create`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const tap = (name) => page.getByRole("button", { name, exact: false }).first().click();
  await tap("Mom");
  await page.getByLabel("Their name").fill("Linda");
  await tap("Continue");
  await tap("Birthday");
  await tap("Continue");
  await tap("Let's do it");
  await tap("Growing up");
  await tap("Her favourite sayings");
  await tap("Continue");
  // A detailed answer: no follow-up needed.
  await page.locator("textarea").first().fill("Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip. Her happy place is the lake house in Michigan.");
  await tap("Continue");
  await page.waitForSelector("text=2 of 2", { timeout: 15000 });
  // A thin answer: expect one dig-deeper follow-up, then answer it.
  await page.locator("textarea").first().fill("She always says we got this.");
  await tap("Continue");
  await page.waitForSelector('button:has-text("Add to the song")', { timeout: 15000 });
  await shot("e2e-0-followup");
  await page.locator("textarea").nth(1).fill("She says it every time I call her before a big exam.");
  await tap("Add to the song");
  await page.waitForSelector("text=hard to say out loud", { timeout: 15000 });
  await page.locator("textarea").first().fill("You made every ordinary Sunday feel like a holiday.");
  await tap("Continue");
  await tap("Cry happy tears");
  await tap("Continue");
  await tap("Country");
  await tap("Female voice");
  await tap("Continue");
  await page.locator('input[type="email"]').fill("tester@example.com");
  await tap("Write Linda's song");
  await page.waitForURL(/\/r\//);
  const songUrl = page.url();
  const id = songUrl.split("/r/")[1];
  await shot("e2e-1-writing");

  // 2. Story-quiz projects record as soon as verified lyrics exist (no "Sing it" step)
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
  await page.waitForSelector('button:has-text("✓ Selected")');
  await page.reload();
  await page.waitForSelector('button:has-text("✓ Selected")');
  const chosenId = (await (await page.request.get(`${BASE}/api/requests/${id}`)).json()).candidates.find((c) => c.selected).id;
  assert.equal(chosenId, api.candidates[1].id, "selection persisted");
  await page.click('button:has-text("full song ·")');
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
