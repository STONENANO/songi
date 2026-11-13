import { NextResponse } from "next/server";
import { getRequest } from "../pipeline/common";
import { checkAccess, type Access } from "../session/project";
import type { SongRequest } from "../db/schema";

/** Load a project and check the caller owns it. Legacy (pre-token) projects are read-only for mutations that move money. */
export async function requireProject(req: Request, id: string, opts: { allowLegacy?: boolean } = {}): Promise<{ r: SongRequest; access: Access } | NextResponse> {
  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = checkAccess(req, r);
  if (access === "link_expired") return NextResponse.json({ error: "This preview link has expired.", code: "link_expired" }, { status: 403 });
  if (access === "denied") return NextResponse.json({ error: "You don't have access to this song." }, { status: 403 });
  if (access === "legacy" && opts.allowLegacy === false) return NextResponse.json({ error: "This older song needs to be recreated before it can be purchased." }, { status: 403 });
  return { r, access };
}
