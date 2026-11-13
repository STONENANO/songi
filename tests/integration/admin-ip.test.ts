import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as ipGET } from "../../src/app/api/admin/ip/route";

type Vars = Record<string, string | undefined>;
async function withEnv<T>(vars: Vars, fn: () => Promise<T>): Promise<T> {
  const keep: Vars = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (v: Vars) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  put(vars);
  try {
    return await fn();
  } finally {
    put(keep);
  }
}

const ask = (headers: Record<string, string>, query = "") => ipGET(new Request(`http://localhost/api/admin/ip${query}`, { headers }));
const ADMIN = { ADMIN_TOKEN: "a".repeat(40), NODE_ENV: "production", CLIENT_IP_HEADER: "x-real-ip" };

test("admin IP check: 404 without the admin token, or with a wrong one", async () => {
  await withEnv(ADMIN, async () => {
    assert.equal((await ask({})).status, 404);
    assert.equal((await ask({ "x-admin-token": "b".repeat(40) })).status, 404);
    assert.equal((await ask({}, "?token=wrong")).status, 404);
  });
});

test("admin IP check: shows the IP the limits use and the headers behind it", async () => {
  await withEnv(ADMIN, async () => {
    const res = await ask({ "x-admin-token": "a".repeat(40), "x-real-ip": "198.51.100.9", "x-forwarded-for": "6.6.6.6, 198.51.100.9" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const j = (await res.json()) as { clientIp: string; usedHeader: string; headers: Record<string, string | null> };
    assert.equal(j.clientIp, "198.51.100.9");
    assert.equal(j.usedHeader, "x-real-ip");
    assert.equal(j.headers["x-forwarded-for"], "6.6.6.6, 198.51.100.9");
    // ?token= works too, like the /admin pages.
    assert.equal((await ask({}, `?token=${"a".repeat(40)}`)).status, 200);
  });
});

test("admin IP check: closed in production when no ADMIN_TOKEN is set", async () => {
  await withEnv({ ...ADMIN, ADMIN_TOKEN: "" }, async () => assert.equal((await ask({ "x-admin-token": "" })).status, 404));
});
