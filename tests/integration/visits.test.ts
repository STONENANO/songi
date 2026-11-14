import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { POST as trackPOST } from "../../src/app/api/track/route";
import { countableVisit, VISIT_EVENT } from "../../src/lib/analytics/visits";

const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const req = (headers: Record<string, string>) => new Request("http://localhost/api/track", { method: "POST", headers: { "Content-Type": "application/json", ...headers } });

test("bots, scripts and the owner's signed-in browser aren't visitors", () => {
  assert.equal(countableVisit(req({ "user-agent": CHROME })), true);
  assert.equal(countableVisit(req({ "user-agent": CHROME, cookie: "_fbp=fb.1.1.2; other=1" })), true);
  for (const ua of ["", "Googlebot/2.1", "facebookexternalhit/1.1", "Mozilla/5.0 HeadlessChrome/120", "curl/8.0", "python-requests/2.31"]) {
    assert.equal(countableVisit(req({ "user-agent": ua })), false, ua || "(none)");
  }
  assert.equal(countableVisit(req({ "user-agent": CHROME, cookie: "sb-adjnchgouygelwfruuzr-auth-token=base64-abc" })), false, "signed in to /admin");
  assert.equal(countableVisit(req({ "user-agent": CHROME, cookie: "a=1; sb-ref-auth-token.0=x" })), false, "chunked auth cookie");
});

test("a visit is stored once per call with the visitor id; filtered visits are not stored", async () => {
  const db = await getDb();
  const post = (vid: string, headers: Record<string, string>) =>
    trackPOST(new Request("http://localhost/api/track", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.90", ...headers }, body: JSON.stringify({ type: VISIT_EVENT, sessionId: vid, payload: { path: "/" } }) }));
  const count = async (vid: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.events).where(and(eq(schema.events.type, VISIT_EVENT), sql`${schema.events.payload}->>'sessionId' = ${vid}`)))[0].n;

  assert.equal((await post("aaaaaaaaaaaaaaaaaaaaaaaa", { "user-agent": CHROME })).status, 204);
  assert.equal(await count("aaaaaaaaaaaaaaaaaaaaaaaa"), 1);
  await post("bbbbbbbbbbbbbbbbbbbbbbbb", { "user-agent": "Googlebot/2.1" });
  await post("cccccccccccccccccccccccc", { "user-agent": CHROME, cookie: "sb-x-auth-token=1" });
  assert.equal(await count("bbbbbbbbbbbbbbbbbbbbbbbb"), 0);
  assert.equal(await count("cccccccccccccccccccccccc"), 0);
});
