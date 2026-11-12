"use client";
/**
 * Cloudflare Turnstile on the quiz's last screen. Most people never see it ("interaction-only");
 * it shows a checkbox only when Cloudflare isn't sure. The token goes with "Write the song"
 * and is checked on the server. Renders nothing when no site key is configured.
 */
import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const turnstileEnabled = SITE_KEY !== "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * onToken("") means "no valid token right now" (expired, failed, reset).
 * Bump resetKey after a submit is refused: tokens are single-use.
 */
export function Turnstile({ onToken, onError, resetKey }: { onToken: (token: string) => void; onError: (message: string) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    if (!turnstileEnabled || !box.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: SITE_KEY,
          action: "create_song",
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: (t: string) => handlers.current.onToken(t),
          "expired-callback": () => handlers.current.onToken(""),
          "error-callback": () => {
            handlers.current.onToken("");
            handlers.current.onError("We couldn't run the quick robot check. Please refresh the page and try again.");
          },
        });
      })
      .catch(() => handlers.current.onError("We couldn't load the quick robot check. Check your connection (or an ad blocker) and refresh."));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey === 0 || !widget.current || !window.turnstile) return;
    handlers.current.onToken("");
    window.turnstile.reset(widget.current);
  }, [resetKey]);

  if (!turnstileEnabled) return null;
  return <div ref={box} style={{ display: "flex", justifyContent: "center", minHeight: 0 }} />;
}
