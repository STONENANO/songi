/**
 * Transactional email: today only the preview link. Postmark or Resend, chosen by which
 * key is set (POSTMARK_SERVER_TOKEN, RESEND_API_KEY), sent from EMAIL_FROM. Off until
 * configured: then nothing is sent and the song page's copy/share buttons are the way
 * to keep the link.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { env } from "../env";
import { BRAND } from "../brand";
import { normalizeBrief } from "../songcraft";
import { previewLinkFor } from "../session/preview-link";
import { reportError } from "../observability";
import { logEvent } from "../pipeline/common";

/**
 * The address as the weekly limit compares it: lower case, no "+tag", and for Gmail no dots
 * (Gmail ignores both, so they would otherwise be free extra addresses).
 */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export type Mail = { to: string; subject: string; text: string; html: string };

/** Send one email. Throws on a provider error; returns false when email isn't configured. */
export async function sendEmail(m: Mail, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const c = env.email;
  if (!c.enabled) return false;
  const res =
    c.provider === "postmark"
      ? await fetchImpl("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: { "X-Postmark-Server-Token": c.postmark, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ From: c.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: "outbound" }),
          signal: AbortSignal.timeout(15_000),
        })
      : await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${c.resend}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: c.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
          signal: AbortSignal.timeout(15_000),
        });
  if (!res.ok) throw new Error(`${c.provider} answered HTTP ${res.status}`);
  return true;
}

/** Marks "preview link emailed" for a song (a row in webhook_receipts, which is unique by id). */
export const previewEmailKey = (requestId: string) => `email:preview-link:${requestId}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The preview-link email for one song. Pure, for tests. */
export function previewLinkEmail(o: { to: string; name: string; url: string; hours: number; brand: string }): Mail {
  const subject = `${o.name}'s song is ready to hear`;
  const text = [
    `Your versions of ${o.name}'s song are ready.`,
    "",
    `Listen here (works on any device for the next ${o.hours} hours):`,
    o.url,
    "",
    "Pick the version that gives you chills and get the full song from that page.",
    "",
    `— ${o.brand}`,
  ].join("\n");
  const name = escapeHtml(o.name);
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#222;max-width:520px;margin:0 auto;padding:24px">
<p>Your versions of <b>${name}</b>'s song are ready.</p>
<p><a href="${escapeHtml(o.url)}" style="display:inline-block;background:#ff5a5f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">Listen to ${name}'s song</a></p>
<p style="color:#666;font-size:14px">The link works on any device for the next ${o.hours} hours. Pick the version that gives you chills and get the full song from that page.</p>
<p style="color:#666;font-size:14px">— ${escapeHtml(o.brand)}</p>
</body></html>`;
  return { to: o.to, subject, text, html };
}

/**
 * Email the direct preview link once the song's versions are ready. At most once per song
 * (extra takes don't send again). Never throws: a failed send is reported and can be retried
 * by the next finalize.
 */
export async function sendPreviewLinkEmail(requestId: string, fetchImpl: typeof fetch = fetch): Promise<"sent" | "not_configured" | "no_email" | "no_link" | "already_sent" | "failed"> {
  if (!env.email.enabled) return "not_configured";
  const db = await getDb();
  const [r] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, requestId)).limit(1);
  if (!r?.email) return "no_email";
  const link = previewLinkFor(r);
  if (!link) return "no_link";
  const key = previewEmailKey(requestId);
  const claimed = await db.insert(schema.webhookReceipts).values({ id: key, source: "email", topic: "preview_link" }).onConflictDoNothing().returning();
  if (!claimed.length) return "already_sent";
  const name = normalizeBrief(r.brief)?.recipient.name || r.recipientName || "your";
  try {
    await sendEmail(previewLinkEmail({ to: r.email, name, url: link.url, hours: env.previewLinkHours, brand: BRAND.name }), fetchImpl);
    await logEvent(requestId, "email:preview_link_sent", {});
    return "sent";
  } catch (e) {
    // Release the claim so a later finalize (e.g. extra takes) can try again.
    await db.delete(schema.webhookReceipts).where(eq(schema.webhookReceipts.id, key));
    reportError(e, { where: "preview_link_email", requestId });
    return "failed";
  }
}
