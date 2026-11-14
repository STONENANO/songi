/**
 * First-party visitor counting for /admin/analytics: one `site:visit` event per browser per
 * day, sent to our own /api/track. Each browser gets a random id (no name, email or IP is
 * stored with it), so visitors are counted once a day however many pages they open.
 *
 * Not counted: /admin and /dev, automated browsers, and (on the server) bots and any browser
 * signed in to /admin, so the owner's own browsing doesn't inflate the numbers.
 */
export const VISIT_EVENT = "site:visit";
const ID_KEY = "cw_vid";
const DAY_KEY = "cw_vday";

/** The browser's own calendar day (YYYY-MM-DD). */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Call on every full page load. Sends at most one visit per browser per day. */
export function countVisit(): void {
  try {
    if (/^\/(admin|dev)(\/|$)/.test(window.location.pathname) || navigator.webdriver) return;
    const today = localDay();
    if (localStorage.getItem(DAY_KEY) === today) return;
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[0-9a-f]{24}$/.test(id)) {
      id = newId();
      localStorage.setItem(ID_KEY, id);
    }
    const body = JSON.stringify({ type: VISIT_EVENT, sessionId: id, payload: { path: window.location.pathname.slice(0, 200) } });
    const sent = navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    localStorage.setItem(DAY_KEY, today);
  } catch {
    /* storage blocked: this visit isn't counted, nothing breaks */
  }
}

/** Server side: crawlers, link previewers and headless browsers that run scripts. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http/i;

/** Should this visit count? Not for bots, and not for a browser signed in to /admin. */
export function countableVisit(req: Request): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return false;
  const cookies = req.headers.get("cookie") ?? "";
  if (/(^|;\s*)sb-[^=;]*-auth-token(\.\d+)?=/.test(cookies)) return false;
  return true;
}
