"use client";

import { useEffect } from "react";
import { captureUtm } from "@/lib/analytics/utm";
import { countVisit } from "@/lib/analytics/visits";

/**
 * On every full page load: remember the UTM tags a visitor arrived with (so their song is
 * credited to that ad) and count the visit once a day for /admin/analytics.
 */
export function UtmCapture() {
  useEffect(() => {
    captureUtm();
    countVisit();
  }, []);
  return null;
}
