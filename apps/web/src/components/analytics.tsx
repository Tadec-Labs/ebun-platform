"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { startAnalytics, trackPageview } from "@/lib/analytics";

/** Starts analytics once and counts a pageview on every route change. Renders nothing. */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    startAnalytics();
  }, []);

  useEffect(() => {
    trackPageview();
  }, [pathname]);

  return null;
}
