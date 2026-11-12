"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-checks the payment every few seconds while it's being confirmed. */
export default function Refresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
