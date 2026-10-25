import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPot } from "@/lib/group/api";
import { PotExperience } from "./pot-experience";

/**
 * The preview card is what the WhatsApp group sees before anyone taps,
 * so it carries the ask: whose gift, and that you can chip in. First
 * name only, and never the amount — the gift and the money are for
 * people who open it. The pot's own data comes from the API; a link
 * preview fetching this page changes nothing (viewing is read-only).
 */
export async function generateMetadata({ params }: PageProps<"/group/[token]">): Promise<Metadata> {
  const { token } = await params;
  const result = await getPot(token);
  const title =
    result.kind === "ok" ? `Chip in for ${result.pot.recipientFirstName}’s gift` : "Chip in for a gift";
  const description =
    result.kind === "ok" && result.pot.organiserFirstName
      ? `${result.pot.organiserFirstName} is putting together a gift. Add your share and a message.`
      : "Add your share and a message — the gift is sent from all of you.";
  const image = result.kind === "ok" ? result.pot.gift.imageUrl : null;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      siteName: "SendEbun",
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
  };
}

export default async function PotPage({ params, searchParams }: PageProps<"/group/[token]">) {
  const { token } = await params;
  // Paystack sends the payer back to /group/<token>?paid=1 and appends
  // its own reference. Neither is proof of payment: the page asks the API.
  const { paid, reference } = await searchParams;
  const result = await getPot(token);

  if (result.kind === "not_found") notFound();
  if (result.kind === "error") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-4 px-7 text-center">
        <p className="font-display text-2xl" style={{ color: "var(--cream)" }}>
          We couldn&rsquo;t open this just now.
        </p>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Nothing is lost. Refresh the page in a moment.
        </p>
      </div>
    );
  }

  return (
    <PotExperience
      token={token}
      pot={result.pot}
      returnedFromPayment={paid === "1"}
      paymentReference={typeof reference === "string" && reference.startsWith("ebgrp_") ? reference : null}
    />
  );
}
