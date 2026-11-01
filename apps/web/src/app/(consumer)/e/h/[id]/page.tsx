import type { Metadata } from "next";
import Link from "next/link";
import { getGiftCatalog } from "@/lib/gifts/get-gift-catalog";
import { HostApiError, hostFetch, hostLinkPath } from "@/lib/events/host-api";
import type { EventHostView } from "@/lib/events/types";
import { HostExperience } from "./host-experience";

export const metadata: Metadata = {
  title: "Your event · SendEbun",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HostPage({ params }: PageProps<"/e/h/[id]">) {
  const { id } = await params;

  let view: EventHostView | null;
  try {
    view = await hostFetch<EventHostView>(id, "");
  } catch (error) {
    if (!(error instanceof HostApiError)) throw error;
    return (
      <Centered title="We couldn’t open this just now.">
        Nothing is lost — every gift is safe. Refresh the page in a moment.
      </Centered>
    );
  }

  if (!view) {
    return (
      <Centered title="This link doesn’t open your event on this device.">
        Open the host link you saved when you set up the event — it signs this device in again.{" "}
        <Link href="/events/new" className="underline underline-offset-2">
          Set up an event
        </Link>
      </Centered>
    );
  }

  // Gifts the host can add to the list: only while the event is open.
  let catalogue: { id: string; name: string; price: number; delivered: boolean }[] = [];
  if (view.public.status === "active" && view.public.giftListEnabled) {
    const result = await getGiftCatalog();
    if (result.kind === "ok") {
      catalogue = result.items
        .map((g) => ({
          id: g.id,
          name: g.name,
          price: g.basePrice + g.deliveryFee,
          delivered: g.deliveryType === "physical",
        }))
        .sort((a, b) => a.price - b.price);
    }
  }

  return <HostExperience shortId={id} view={view} catalogue={catalogue} hostLinkPath={await hostLinkPath(id)} />;
}

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-4 px-7 text-center">
      <p className="font-display text-2xl" style={{ color: "var(--cream)" }}>
        {title}
      </p>
      <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        {children}
      </p>
    </div>
  );
}
