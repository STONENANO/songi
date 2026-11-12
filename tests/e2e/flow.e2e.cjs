/**
 * Browser end-to-end test (mock providers). Requires Playwright and a running
 * dev server started with mock settings, e.g.:
 *   MOCK_LLM=1 MOCK_KIE=1 MOCK_PAYMENTS=1 MOCK_KIE_DELAY_MS=1500 npm run dev
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
  await tap("Birthday"); // occasion tiles move on by themselves
  await tap("Growing up");
  await tap("Her favourite sayings");
  await tap("Continue");
  // Tap-first topic: answer tile, narrowing chip, one optional detail.
  await tap("In the kitchen");
  await tap("Cooked my favourite");
  await page.getByPlaceholder("One detail you still remember").fill("She made pancakes every Sunday and sang off-key");
  await shot("e2e-0-tap");
  await tap("Continue");
  // Fill-in-the-blank story card: two suggestions and one typed answer.
  await page.waitForSelector(".ui-madlib", { timeout: 15000 });
  await tap("“we got this”");
  await tap("things get hard");
  await page.getByPlaceholder("Or type your own…").fill("like I can do anything");
  await tap("Fill");
  await page.waitForSelector("text=going in Linda's song");
  await shot("e2e-0-blanks");
  await tap("Continue");
  // The open box, then read back and confirm.
  await page.waitForSelector("text=Anything else for Linda's song?");
  await page.locator("textarea").nth(0).fill("You made every ordinary Sunday feel like a holiday.");
  await page.locator("textarea").nth(1).fill("Her happy place is the lake house in Michigan.");
  await tap("Continue");
  await page.waitForSelector("text=Here's what we heard about Linda");
  const lines = await page.locator(".ui-beat .ui-beat__text").allInnerTexts();
  assert.equal(lines.length, 3, "two topics and the open box are read back");
  assert.ok(lines[1].includes("Linda always says “we got this”"), "story card reads back as a sentence");
  await page.getByRole("button", { name: "✏️ Fix" }).first().click();
  await page.locator("textarea").first().fill("Growing up, she cooked my favourite in the kitchen every Sunday, singing off-key.");
  await tap("Save");
  assert.ok(await page.isVisible("text=edited by you"), "edit is marked");
  await shot("e2e-0-readback");
  await tap("Yes, that's our story");
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
  // The brief is built from the read-back lines, including the buyer's edit.
  assert.ok(api.brief.facts.some((f) => /off-key/i.test(f.text)), "edited read-back line reached the brief");
  assert.ok(!api.brief.facts.some((f) => /^Q:/.test(f.text)), "no question text leaked into facts");
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
  // Our own checkout page (test mode without Stripe keys), then the post-purchase page.
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/);
  assert.ok(await page.isVisible("text=Linda's full song"), "checkout shows the song");
  // A stranger can't open someone else's checkout.
  const strangerPage = await (await browser.newContext()).newPage();
  await strangerPage.goto(page.url());
  assert.ok(await strangerPage.isVisible("text=started on another device"), "checkout is owner-only");
  await strangerPage.context().close();
  await shot("e2e-3-checkout");
  await page.click('button:has-text("Pay (test)")');
  // Paying lands straight on the song's player page, with a one-time thank-you.
  await page.waitForURL(/\/d\/[^/?]+\?new=1$/, { timeout: 30000 });
  const playerUrl = page.url().split("?")[0];
  await page.waitForSelector("text=It's yours.", { timeout: 30000 });
  assert.ok(await page.isVisible('a[aria-label="Download MP3"]'), "download in the top corner");
  assert.ok((await page.locator("button.pl-line").count()) > 4, "timed lyric lines");
  await shot("e2e-3b-player");
  // Play: the lyric highlight follows the song.
  await page.click('button[aria-label="Play"]');
  await page.waitForSelector("button.pl-line.is-active", { timeout: 20000 });
  // Coming back to the old song page goes to the player page too.
  await page.goto(songUrl);
  await page.waitForURL((u) => u.href.startsWith(playerUrl), { timeout: 30000 });
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
