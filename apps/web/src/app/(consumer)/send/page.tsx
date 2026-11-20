import type { Metadata } from "next";
import {
  corporateSelfServeEnabled,
  eventsEnabled,
  groupGiftingEnabled,
  mediaMessagesEnabled,
  whatsappAutoDeliveryEnabled,
} from "@/lib/feature-flags";
import { getCities } from "@/lib/cities/cities";
import { getGiftCatalog } from "@/lib/gifts/get-gift-catalog";
import { SendExperience } from "./send-experience";

export const metadata: Metadata = {
  title: "Send a gift",
  description: "Choose a gift to send.",
};

export default async function SendPage() {
  const [catalog, cities] = await Promise.all([getGiftCatalog(), getCities()]);

  return (
    <SendExperience
      catalog={catalog.kind === "ok" ? catalog.items : []}
      catalogReachable={catalog.kind === "ok"}
      cities={cities}
      allowScheduling={whatsappAutoDeliveryEnabled()}
      allowRecordings={mediaMessagesEnabled()}
      companiesOpen={corporateSelfServeEnabled()}
      groupGifting={groupGiftingEnabled()}
      eventsOpen={eventsEnabled()}
    />
  );
}
