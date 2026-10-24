import { LEGAL } from "@/lib/legal";

/**
 * The few places the app points people to outside a flow. One file, so
 * the send flow, the company pages and the legal footer can't drift.
 */

/** The marketing site. */
export const LANDING_URL = `https://${LEGAL.website.replace(/^https?:\/\//, "")}`;

/**
 * "Run a shop, restaurant or spa?" — a WhatsApp chat with SendEbun, the
 * first message already written. Partners are signed one by one and get
 * their private link from that chat, so a conversation beats a form.
 */
export function becomePartnerUrl(): string {
  const digits = LEGAL.phone.replace(/\D/g, "");
  const text = [
    "Hi SendEbun, I'd like to become a partner.",
    "",
    "Business name: ",
    "Area / address: ",
    "What we offer (food, pampering, experiences…): ",
  ].join("\n");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** "Need help?" — straight to a person on WhatsApp. */
export function helpUrl(): string {
  const digits = LEGAL.phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent("Hi SendEbun, I need a hand with a gift.")}`;
}
