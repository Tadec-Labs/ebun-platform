import type { Metadata } from "next";
import { mediaMessagesEnabled, whatsappAutoDeliveryEnabled } from "@/lib/feature-flags";
import { getGiftCatalog } from "@/lib/gifts/get-gift-catalog";
import { SendExperience } from "./send-experience";

export const metadata: Metadata = {
  title: "Send a gift",
  description: "Choose a gift to send.",
};

export default async function SendPage() {
  const catalog = await getGiftCatalog();

  return (
    <SendExperience
      catalog={catalog.kind === "ok" ? catalog.items : []}
      catalogReachable={catalog.kind === "ok"}
      allowScheduling={whatsappAutoDeliveryEnabled()}
      allowRecordings={mediaMessagesEnabled()}
    />
  );
}
