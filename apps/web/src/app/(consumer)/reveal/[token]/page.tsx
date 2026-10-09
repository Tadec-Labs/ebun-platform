import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRevealView } from "@/lib/reveal/get-reveal-view";
import { RevealExperience } from "./reveal-experience";

export const metadata: Metadata = {
  title: "A gift for you — Ebun",
  description: "Someone sent you something.",
  // A private, single-recipient link. Nothing here belongs in an index,
  // and link previews shouldn't be the thing that "opens" a gift.
  robots: { index: false, follow: false },
};

export default async function RevealPage({ params }: PageProps<"/reveal/[token]">) {
  const { token } = await params;
  const result = await getRevealView(token);

  // A bad token and a mistyped URL are the same thing to a recipient,
  // so both land on the standard not-found page rather than a bespoke
  // screen that would only ever confirm which tokens exist.
  if (result.kind === "not_found") notFound();

  if (result.kind === "error") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-4 px-7 text-center">
        <p className="font-display text-2xl" style={{ color: "var(--cream)" }}>
          We couldn&rsquo;t open this just now.
        </p>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          The gift is safe. Refresh the page in a moment and it should be here.
        </p>
      </div>
    );
  }

  return <RevealExperience token={token} initial={result.payload} />;
}
