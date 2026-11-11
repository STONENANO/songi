import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb, schema } from "../../src/lib/db";
import { newProjectToken, cookieName } from "../../src/lib/session/project";
import { POST as feedbackPOST } from "../../src/app/api/requests/[id]/feedback/route";
import { adminAllowed, adminList, adminDetail } from "../../src/lib/admin";
import { getRequestView } from "../../src/lib/pipeline/run";

async function project() {
  const db = await getDb();
  const t = newProjectToken();
  const [r] = await db
    .insert(schema.songRequests)
    .values({ recipientName: "Ruth", relationship: "grandma", occasion: "birthday", story: "She does the Saturday crossword in pen.", genreKey: "acoustic", vocalGender: "f", accessTokenHash: t.hash })
    .returning();
  return { id: r.id, token: t.token };
}

const call = (id: string, body: unknown, cookie?: string) =>
  feedbackPOST(new Request(`http://localhost/api/requests/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

test("feedback: only the project owner can leave it, it is validated, and it shows on the view and in admin", async () => {
  const { id, token } = await project();
  const cookie = `${cookieName(id)}=${token}`;
  assert.equal((await call(id, { rating: 5 })).status, 403, "stranger refused");
  assert.equal((await call(id, { rating: 9 }, cookie)).status, 400, "rating out of range");
  assert.equal((await call(id, { rating: 4, wouldPay: "maybe", note: "Loved the crossword line" }, cookie)).status, 200);
  assert.equal((await call(id, { rating: 5, wouldPay: "yes" }, cookie)).status, 200);

  const v = await getRequestView(id);
  assert.deepEqual(v?.feedback, { rating: 5, wouldPay: "yes", note: null }, "latest feedback wins");

  const row = (await adminList()).find((r) => r.id === id);
  assert.equal(row?.feedback?.rating, 5);
  const d = await adminDetail(id);
  assert.equal(d?.feedback.length, 2);
  assert.equal(d?.request.story, "She does the Saturday crossword in pen.");
});

test("admin is open locally without a token, and needs the exact token once one is set", () => {
  const before = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  assert.equal(adminAllowed(undefined), true);
  process.env.ADMIN_TOKEN = "s3cret-token";
  assert.equal(adminAllowed(undefined), false);
  assert.equal(adminAllowed("wrong-token!"), false);
  assert.equal(adminAllowed("s3cret-token"), true);
  if (before === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = before;
});
