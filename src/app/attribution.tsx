"use client";

import { useEffect } from "react";
import { captureUtm } from "@/lib/analytics/utm";

/** Remembers the UTM tags a visitor arrived with, so the song they make is credited to that ad. */
export function UtmCapture() {
  useEffect(() => captureUtm(), []);
  return null;
}
