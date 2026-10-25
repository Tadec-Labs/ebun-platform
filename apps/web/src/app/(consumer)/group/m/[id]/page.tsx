import type { Metadata } from "next";
import Link from "next/link";
import { getGiftCatalog } from "@/lib/gifts/get-gift-catalog";
import { OrganiserApiError, organiserFetch, organiserLinkPath } from "@/lib/group/organiser-api";
import type { GroupGiftOrganiserView } from "@/lib/group/types";
import { OrganiserExperience } from "./organiser-experience";

export const metadata: Metadata = {
  title: "Your group gift",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrganiserPage({ params }: PageProps<"/group/m/[id]">) {
  const { id } = await params;

  let view: GroupGiftOrganiserView | null;
  try {
    view = await organiserFetch<GroupGiftOrganiserView>(id, "");
  } catch (error) {
    if (!(error instanceof OrganiserApiError)) throw error;
    return (
      <Centered title="We couldn’t open this just now.">
        Nothing is lost — every share is safe. Refresh the page in a moment.
      </Centered>
    );
  }

  if (!view) {
    return (
      <Centered title="This link doesn’t open your gift on this device.">
        Open the organiser link you saved when you started the gift — it signs this device in again.{" "}
        <Link href="/send" className="underline underline-offset-2">
          Send a gift
        </Link>
      </Centered>
    );
  }

  // Gifts the pot already covers, for "switch to something it covers".
  // Only fetched when that decision can actually be made.
  let affordable: { id: string; name: string; imageUrl: string | null; price: number }[] = [];
  if (view.canSwitch) {
    const catalog = await getGiftCatalog();
    if (catalog.kind === "ok") {
      affordable = catalog.items
        .map((g) => ({ id: g.id, name: g.name, imageUrl: g.imageUrl, price: g.basePrice + g.deliveryFee }))
        .filter((g) => g.price <= view.amountRaised && g.id !== view.gift.giftTemplateId)
        .sort((a, b) => b.price - a.price);
    }
  }

  return (
    <OrganiserExperience
      shortId={id}
      view={view}
      affordable={affordable}
      organiserLinkPath={await organiserLinkPath(id)}
    />
  );
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
