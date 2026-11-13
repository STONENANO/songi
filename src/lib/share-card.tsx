/**
 * The image shown when a link is shared (Open Graph / Twitter card), 1200 x 630.
 * One layout for every page: a warm paper card, the mascot, an eyebrow, a big title and a
 * subline. Rendered on the server with next/og; fonts and art are bundled in app/og-assets
 * so nothing is fetched at render time.
 */
import { ImageResponse } from "next/og";
import fs from "node:fs/promises";
import path from "node:path";
import { BRAND } from "./brand";

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };

const ASSETS = path.join(process.cwd(), "src/app/og-assets");
let assets: Promise<{ display: Buffer; body: Buffer; art: Record<string, string> }> | null = null;
function loadAssets() {
  assets ??= (async () => {
    const [display, body, hero, headphones] = await Promise.all(
      ["bricolage-700.ttf", "geist-500.ttf", "hero.png", "headphones.png"].map((f) => fs.readFile(path.join(ASSETS, f))),
    );
    const png = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
    return { display, body, art: { hero: png(hero), headphones: png(headphones) } };
  })();
  return assets;
}

/** Long names shrink so the title still fits on two lines. */
function titleSize(title: string) {
  if (title.length <= 22) return 92;
  if (title.length <= 28) return 80;
  if (title.length <= 44) return 62;
  return 52;
}

export async function shareCard(o: { eyebrow: string; title: string; sub: string; mascot?: "hero" | "headphones" }) {
  const { display, body, art } = await loadAssets();
  const title = o.title.length > 70 ? `${o.title.slice(0, 67)}…` : o.title;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff9f5", padding: 56, fontFamily: "Geist" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "#ffffff",
            borderRadius: 40,
            border: "3px solid #f0e2dc",
            boxShadow: "0 14px 0 #ffe2d4",
            padding: "48px 40px 48px 64px",
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
            <div style={{ display: "flex", fontSize: 30, color: "#dc3d1c", fontFamily: "Bricolage" }}>{BRAND.name}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 28, color: "#5e5160", marginBottom: 14 }}>{o.eyebrow}</div>
              <div style={{ display: "flex", fontSize: titleSize(title), lineHeight: 1.04, color: "#1f1420", fontFamily: "Bricolage", letterSpacing: -1.5 }}>{title}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", background: "linear-gradient(135deg, #ff4b2b 0%, #ff8a2f 100%)", color: "#fff", fontSize: 28, padding: "14px 30px", borderRadius: 999 }}>{o.sub}</div>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art[o.mascot ?? "hero"]} width={330} height={o.mascot === "headphones" ? 357 : 334} alt="" style={{ marginLeft: 24 }} />
        </div>
      </div>
    ),
    {
      ...SHARE_IMAGE_SIZE,
      fonts: [
        { name: "Bricolage", data: display, weight: 700, style: "normal" },
        { name: "Geist", data: body, weight: 500, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    },
  );
}
