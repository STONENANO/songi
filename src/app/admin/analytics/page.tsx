import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { env } from "@/lib/env";
import { getSongPrice } from "@/lib/commerce/pricing";
import { loadReport, RANGES, type RangeId } from "@/lib/analytics/load";
import { Dashboard } from "./dashboard";
import "./analytics.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Analytics" };

/**
 * Conversion, funnel, revenue and gross profit, in the app's own style. The numbers come from
 * our database (lib/analytics); the charts render in the browser for hover and keyboard reading.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const [{ range }, { email }] = await Promise.all([searchParams, requireAdmin()]);
  const rangeId = (RANGES.some((r) => r.id === range) ? range : "30") as RangeId;
  const [report, price] = await Promise.all([loadReport(rangeId), getSongPrice()]);
  return <Dashboard report={report} ranges={RANGES.map((r) => ({ id: r.id, label: r.label }))} email={email} testMode={env.stripeTestMode} priceLabel={price.label} />;
}
