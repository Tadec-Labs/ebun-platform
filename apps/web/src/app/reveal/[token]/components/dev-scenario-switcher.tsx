import Link from "next/link";
import { MOCK_SCENARIOS } from "@/lib/reveal/mock-data";

/**
 * Only for use while apps/web has no real /reveal endpoint to hit.
 * `process.env.NODE_ENV !== "production"` is inlined at build time by
 * Next's bundler, so this whole component (and the import above) is
 * dead-code-eliminated from production builds — nothing to remember to
 * remove before wiring the real endpoint, other than deleting the file.
 */
export function DevScenarioSwitcher({ current }: { current: string }) {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap justify-center gap-1.5 border-t p-2"
      style={{ borderColor: "var(--border)", background: "rgba(14,13,11,0.92)" }}
    >
      {Object.keys(MOCK_SCENARIOS).map((key) => (
        <Link
          key={key}
          href={`/reveal/${key}`}
          className="rounded-full border px-2.5 py-1 text-[10px]"
          style={{
            borderColor: key === current ? "var(--gold)" : "var(--border)",
            color: key === current ? "var(--gold-light)" : "var(--cream-faint)",
          }}
        >
          {key.replace("mock-", "")}
        </Link>
      ))}
    </div>
  );
}
