import type { Metadata } from "next";
import { corporateSelfServeEnabled, eventsEnabled } from "@/lib/feature-flags";
import { Launcher } from "./launcher";

export const metadata: Metadata = {
  title: "SendEbun",
  description: "Gifts for someone, for an event, or for your team.",
};

/**
 * The front door: one question, three answers. Links from outside (the
 * landing page, invitations, Instagram) go straight to /send, /e/… or
 * /company/start; this is for people who come to the app itself. Tiles
 * for products that are switched off don't show.
 */
export default function Home() {
  return <Launcher eventsOpen={eventsEnabled()} companiesOpen={corporateSelfServeEnabled()} />;
}
