import type { Metadata } from "next";
import { getGiftCatalog } from "@/lib/gifts/get-gift-catalog";
import { SendExperience } from "./send-experience";

export const metadata: Metadata = {
  title: "Send a gift — Ebun",
  description: "Choose a gift to send.",
};

export default async function SendPage() {
  const catalog = await getGiftCatalog();

  return <SendExperience catalog={catalog} />;
}
