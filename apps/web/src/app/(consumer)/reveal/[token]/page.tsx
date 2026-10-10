import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GiftMark } from "@/components/icons";
import { isLinkPreviewFetcher } from "@/lib/link-preview-bot";
import { getRevealView } from "@/lib/reveal/get-reveal-view";
import { RevealExperience } from "./reveal-experience";

const PREVIEW_TITLE = "You’ve been sent a gift";
const PREVIEW_DESCRIPTION = "Tap to open it — someone who knows you sent this.";

/**
 * The preview card is the first thing the recipient sees, before they
 * tap anything — so it is written for them, and is identical for every
 * gift. Nothing per-order goes in it: no name, no gift, no sender.
 * The card is drawn by whoever holds the link, and a preview that
 * named the gift would give the surprise away in the chat list.
 */
export const metadata: Metadata = {
  title: "A gift for you — Ebun",
  description: PREVIEW_DESCRIPTION,
  // A private, single-recipient link. Nothing here belongs in an index.
  robots: { index: false, follow: false },
  openGraph: {
    title: PREVIEW_TITLE,
    description: PREVIEW_DESCRIPTION,
    siteName: "Ebun",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: PREVIEW_TITLE, description: PREVIEW_DESCRIPTION },
};

export default async function RevealPage({ params }: PageProps<"/reveal/[token]">) {
  const { token } = await params;

  // Before any API call: a chat app fetching this URL to draw a preview
  // must never count as the recipient opening the gift. See
  // lib/link-preview-bot.ts — notably, the sender's own WhatsApp fetches
  // it the moment they paste the link.
  if (isLinkPreviewFetcher((await headers()).get("user-agent"))) {
    return <PreviewPlaceholder />;
  }

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

/**
 * What a preview fetcher receives instead of the gift. Never rendered
 * for a person in practice; kept presentable in case a real browser
 * ever matches a preview agent string.
 */
function PreviewPlaceholder() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-5 px-7 text-center">
      <GiftMark className="h-12 w-12 text-[color:var(--gold)]" />
      <p className="font-display text-3xl" style={{ color: "var(--cream)" }}>
        {PREVIEW_TITLE}
      </p>
      <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
        {PREVIEW_DESCRIPTION}
      </p>
    </div>
  );
}
