"use client";

import { useEffect } from "react";
import { type RecentKind, rememberRecent } from "@/lib/recent";

/** Renders nothing; adds this page to "Continue" on the front door. */
export function RememberRecent({ kind, title, path }: { kind: RecentKind; title: string; path: string }) {
  useEffect(() => {
    rememberRecent({ kind, title, path });
  }, [kind, title, path]);
  return null;
}
