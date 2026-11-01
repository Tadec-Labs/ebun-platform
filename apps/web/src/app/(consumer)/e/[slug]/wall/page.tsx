import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/events/api";
import { EVENT_COPY } from "@/lib/events/copy";
import { renderQrSvg } from "@/lib/reveal/qr";
import { SprayWall } from "./spray-wall";

export const metadata: Metadata = {
  title: "Live wall · SendEbun",
  robots: { index: false, follow: false },
};

/**
 * E5 · The venue screen. Opened on a laptop plugged into the hall's
 * projector or TV. It shows only what the wall feed returns — names and
 * lines guests chose to show — and a QR code to the guest page.
 */
export default async function WallPage({ params }: PageProps<"/e/[slug]/wall">) {
  const { slug } = await params;
  const result = await getEvent(slug);
  if (result.kind === "not_found") notFound();
  if (result.kind === "error") {
    return <Message>We couldn&rsquo;t open the wall just now. Refresh in a moment.</Message>;
  }
  const { event } = result;
  if (!event.wallEnabled) {
    return <Message>The host has turned the live wall off for this event.</Message>;
  }

  // The QR has to carry the full address, so it's built from the request
  // the screen itself came in on (works on any domain or preview URL).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.ebun.com.ng";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const guestUrl = `${proto}://${host}/e/${event.slug}`;
  const qrSvg = await renderQrSvg(guestUrl);

  return (
    <SprayWall
      slug={event.slug}
      title={event.title}
      copy={EVENT_COPY[event.eventType]}
      guestPath={`${host}/e/${event.slug}`}
      qrSvg={qrSvg}
      cashOpen={event.cashOpen}
    />
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-10 text-center">
      <p className="font-display text-3xl" style={{ color: "var(--cream)" }}>
        {children}
      </p>
    </div>
  );
}
