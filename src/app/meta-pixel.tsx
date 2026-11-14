"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { metaTrack, startMetaPixel } from "@/lib/analytics/meta-pixel";

/** Starts the Meta Pixel and sends a PageView on every page, including in-app navigation. */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const path = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!pixelId || last.current === path) return;
    last.current = path;
    startMetaPixel(pixelId);
    metaTrack("PageView");
  }, [pixelId, path]);
  return null;
}

/** Sends one Meta event when a page shows (checkout opened, purchase confirmed). */
export function MetaEvent({ name, eventId, params }: { name: "InitiateCheckout" | "Purchase"; eventId: string; params: Record<string, unknown> }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    metaTrack(name, params, eventId);
  }, [name, eventId, params]);
  return null;
}
