import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTouch, touchFromUrl, UtmSchema } from "../../src/lib/analytics/utm";

const META = "https://www.getcryworthy.com/create?utm_source=facebook&utm_medium=paid&utm_campaign=Mom%20Birthday%20Q4&utm_term=Moms%2035-55&utm_content=hook_v2_tears&fbclid=IwAR123";

test("reads the five UTM tags, the landing path and the referring site", () => {
  const t = touchFromUrl(META, "https://l.facebook.com/l.php?u=x", 1000);
  assert.deepEqual(t, {
    at: 1000,
    source: "facebook",
    medium: "paid",
    campaign: "Mom Birthday Q4",
    term: "Moms 35-55",
    content: "hook_v2_tears",
    landing: "/create",
    referrer: "l.facebook.com",
  });
});

test("a link without UTM tags is not a touch; junk is trimmed and capped", () => {
  assert.equal(touchFromUrl("https://www.getcryworthy.com/?fbclid=x", ""), null);
  assert.equal(touchFromUrl("not a url", ""), null);
  const long = touchFromUrl(`https://x.com/?utm_content=${"a".repeat(500)}&utm_source=%20%20tiktok%0A`, "", 1);
  assert.equal(long?.content?.length, 200);
  assert.equal(long?.source, "tiktok");
  assert.equal(touchFromUrl("https://x.com/?utm_source=a", "https://x.com/page", 1)?.referrer, undefined, "own site is not a referrer");
});

test("first touch is kept, last touch is replaced, plain visits change nothing", () => {
  const a = touchFromUrl("https://x.com/?utm_source=facebook&utm_content=ad_A", "", 1000)!;
  const b = touchFromUrl("https://x.com/?utm_source=facebook&utm_content=ad_B", "", 2000)!;
  const one = mergeTouch(null, a, 1000);
  assert.deepEqual(one, { first: a, last: a });
  const two = mergeTouch(one, b, 2000);
  assert.equal(two?.first.content, "ad_A");
  assert.equal(two?.last.content, "ad_B");
  assert.deepEqual(mergeTouch(two, null, 3000), two, "an untagged visit keeps the stored ad");
});

test("attribution expires after 30 days", () => {
  const a = touchFromUrl("https://x.com/?utm_source=facebook", "", 0)!;
  const stored = mergeTouch(null, a, 0);
  assert.ok(mergeTouch(stored, null, 29 * 86_400_000));
  assert.equal(mergeTouch(stored, null, 31 * 86_400_000), null);
  const b = touchFromUrl("https://x.com/?utm_source=tiktok", "", 31 * 86_400_000)!;
  assert.equal(mergeTouch(stored, b, 31 * 86_400_000)?.first.source, "tiktok", "an expired first touch is replaced too");
});

test("the server only accepts well-formed attribution", () => {
  const a = touchFromUrl(META, "", 5)!;
  assert.ok(UtmSchema.safeParse({ first: a, last: a }).success);
  assert.ok(!UtmSchema.safeParse({ first: a }).success);
  assert.ok(!UtmSchema.safeParse({ first: a, last: { ...a, content: "x".repeat(201) } }).success);
  assert.ok(!UtmSchema.safeParse("facebook").success);
});
