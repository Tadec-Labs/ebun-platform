import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EVENT_COPY, formatEventDate } from "@/lib/events/copy";
import { getEvent } from "@/lib/events/api";
import { EventExperience } from "./event-experience";

/**
 * The preview card is what a WhatsApp group sees before anyone taps:
 * whose event and when. Never an amount.
 */
export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getEvent(slug);
  if (result.kind !== "ok") return { title: "SendEbun", robots: { index: false, follow: false } };
  const { event } = result;
  const copy = EVENT_COPY[event.eventType];
  const title = `${copy.eyebrow} ${event.title}`;
  const description = `${formatEventDate(event.eventDate)} · ${event.city}. Give from the gift list${
    event.cashOpen ? ` or ${copy.cash.toLowerCase()}` : ""
  } — from anywhere, in a minute.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, siteName: "SendEbun", type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function EventPage({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  // Paystack sends the guest back to /e/<slug>?paid=1 and appends its own
  // reference. Neither is proof of payment: the page asks the API.
  const { paid, reference } = await searchParams;
  const result = await getEvent(slug);

  if (result.kind === "not_found") notFound();
  if (result.kind === "error") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-4 px-7 text-center">
        <p className="font-display text-2xl" style={{ color: "var(--cream)" }}>
          We couldn&rsquo;t open this just now.
        </p>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Refresh the page in a moment.
        </p>
      </div>
    );
  }

  return (
    <EventExperience
      event={result.event}
      returnedFromPayment={paid === "1"}
      paymentReference={typeof reference === "string" && reference.startsWith("ebevt_") ? reference : null}
    />
  );
}
