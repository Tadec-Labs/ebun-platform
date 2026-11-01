/**
 * "Pick up where you left off" on the launcher. Kept in this browser
 * only, and only the clean page address (/e/h/<short id>, /group/m/<id>)
 * — never a token. The short id opens nothing by itself: the private
 * link's cookie on this device is what lets the page load.
 */
export type RecentKind = "event" | "pot";

export interface RecentEntry {
  kind: RecentKind;
  title: string;
  path: string;
  at: number;
}

const KEY = "ebun_recent";
const MAX = 3;
const SAFE_PATH = /^\/(e\/h|group\/m)\/[0-9a-f]{12}$/;

/** The stored value as a string — a stable snapshot for useSyncExternalStore. */
export function recentSnapshot(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function readRecent(raw: string = recentSnapshot()): RecentEntry[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as RecentEntry).title === "string" &&
          typeof (e as RecentEntry).path === "string" &&
          SAFE_PATH.test((e as RecentEntry).path),
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberRecent(entry: Omit<RecentEntry, "at">): void {
  if (!SAFE_PATH.test(entry.path)) return;
  try {
    const rest = readRecent().filter((e) => e.path !== entry.path);
    const next = [{ ...entry, title: entry.title.slice(0, 80), at: Date.now() }, ...rest].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage full: the launcher just won't list it.
  }
}
