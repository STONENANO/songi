/** Loads the rows /admin/analytics needs from the database and builds the report. */
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "../db";
import { env } from "../env";
import { VISIT_EVENT } from "./visits";
import { buildReport, daysSince, periodDays, type Report, type ReportInput } from "./report";

export const RANGES = [
  { id: "today", label: "Today", days: 1 },
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "all", label: "All time", days: 0 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

export async function loadReport(rangeId: RangeId, now = new Date()): Promise<Report> {
  const tz = env.analyticsTimeZone;
  const db = await getDb();
  const { events, songRequests, orders, costLedger } = schema;
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];

  let days: string[];
  let previous: string[] | null;
  let since: Date | null;
  if (range.days > 0) {
    ({ days, previous } = periodDays(now, range.days, tz));
    // A day of slack either side of the time zone; rows outside the days are ignored.
    since = new Date(now.getTime() - (2 * range.days + 2) * 86_400_000);
  } else {
    const [first] = await db.select({ at: sql<Date>`min(${songRequests.createdAt})` }).from(songRequests);
    days = daysSince(first?.at ? new Date(first.at) : now, now, tz);
    previous = null;
    since = null;
  }
  const after = (col: AnyPgColumn) => (since ? gte(col, since) : undefined);

  const [visits, quizStarts, songs, costs] = await Promise.all([
    db
      .select({ visitor: sql<string>`${events.payload}->>'sessionId'`, at: events.createdAt })
      .from(events)
      .where(and(eq(events.type, VISIT_EVENT), after(events.createdAt))),
    db
      .select({ session: sql<string>`${events.payload}->>'sessionId'`, at: events.createdAt })
      .from(events)
      .where(and(eq(events.type, "quiz:step_view"), sql`${events.payload}->>'step' = 'who'`, after(events.createdAt))),
    db
      .select({ id: songRequests.id, at: songRequests.createdAt, occasion: songRequests.occasion, finalizedAt: songRequests.candidatesFinalizedAt, status: songRequests.status, utm: songRequests.utm })
      .from(songRequests)
      .where(after(songRequests.createdAt)),
    db.select({ at: costLedger.createdAt, usd: costLedger.costUsd }).from(costLedger).where(after(costLedger.createdAt)),
  ]);
  // Orders paid, created or refunded in the window, plus every order of the songs started in it.
  const songIds = songs.map((s) => s.id);
  const orderRows = await db
    .select()
    .from(orders)
    .where(since ? or(gte(orders.createdAt, since), gte(orders.paidAt, since), gte(orders.refundedAt, since), songIds.length ? inArray(orders.requestId, songIds) : undefined) : undefined);

  const input: ReportInput = {
    visits: visits.filter((v) => v.visitor).map((v) => ({ visitor: v.visitor, at: v.at })),
    quizStarts: quizStarts.filter((q) => q.session).map((q) => ({ session: q.session, at: q.at })),
    songs: songs.map((s) => ({
      id: s.id,
      at: s.at,
      occasion: s.occasion,
      previewsReady: !!s.finalizedAt || s.status === "preview_ready" || s.status === "purchased",
      source: s.utm?.last.source,
      campaign: s.utm?.last.campaign,
      ad: s.utm?.last.content,
    })),
    orders: orderRows.map((o) => ({
      requestId: o.requestId,
      status: o.status,
      amountCents: o.amountCents,
      taxCents: o.taxCents,
      real: !!(o.stripePaymentIntentId || o.stripeCheckoutSessionId),
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      refundedAt: o.refundedAt,
    })),
    costs: costs.map((c) => ({ at: c.at, usd: Number(c.usd ?? 0) })),
  };
  return buildReport(input, { range: range.id, days, previous, tz, fee: env.stripeFee });
}
