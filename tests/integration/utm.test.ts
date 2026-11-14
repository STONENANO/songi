import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { POST as createPOST } from "../../src/app/api/requests/route";
import { touchFromUrl } from "../../src/lib/analytics/utm";

/** Creates a song; the route's after() can't run outside a real server, but the song is saved before it. */
async function create(story: string, ip: string, extra: Record<string, unknown>) {
  const body = { relationship: "friend", occasion: "birthday", story, genreKey: "pop", ...extra };
  try {
    await createPOST(new Request("http://localhost/api/requests", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  } catch (e) {
    if (!/`after` was called outside a request scope/.test((e as Error).message)) throw e;
  }
  const db = await getDb();
  const [row] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.story, story)).limit(1);
  return row;
}

test("a new song keeps the ad that brought the visitor, and not in the quiz snapshot", async () => {
  const first = touchFromUrl("https://x.com/?utm_source=facebook&utm_campaign=Q4&utm_content=hook_v1", "", 1000)!;
  const last = touchFromUrl("https://x.com/create?utm_source=facebook&utm_campaign=Q4&utm_content=hook_v2", "", 2000)!;
  const row = await create("UTM test one: she sings to her plants every morning.", "198.51.100.71", { utm: { first, last } });
  assert.ok(row, "song saved");
  assert.equal(row.utm?.first.content, "hook_v1");
  assert.equal(row.utm?.last.content, "hook_v2");
  assert.equal(row.utm?.last.campaign, "Q4");
  assert.equal((row.quizSnapshot as Record<string, unknown>).utm, undefined);
});

test("malformed or missing attribution never blocks a song", async () => {
  const bad = await create("UTM test two: he fixes every bike on the street.", "198.51.100.72", { utm: { last: "nonsense" } });
  assert.ok(bad, "song saved despite bad tags");
  assert.equal(bad.utm, null);
  const none = await create("UTM test three: they dance in the kitchen on Sundays.", "198.51.100.73", {});
  assert.ok(none);
  assert.equal(none.utm, null);
});
