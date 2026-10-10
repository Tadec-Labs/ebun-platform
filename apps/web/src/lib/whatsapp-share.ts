/**
 * Builds the "Send on WhatsApp" link for a gift.
 *
 * wa.me is WhatsApp's own click-to-chat URL: on a phone it opens the
 * app, on a laptop WhatsApp Desktop or Web, straight into a chat with
 * the message typed and waiting. Nothing is sent until the sender taps
 * send, and they can edit the words first — it is their message, from
 * their number, which is also why it lands as from someone the
 * recipient knows rather than from an unknown business account.
 *
 * Phone is E.164 from the API ("+2348012345678"); wa.me wants digits
 * only. With no phone, wa.me opens WhatsApp's own contact picker.
 */
export function whatsappChatUrl(phone: string | null, text: string): string {
  const digits = phone?.replace(/\D/g, "") ?? "";
  const query = `text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}?${query}` : `https://wa.me/?${query}`;
}

/**
 * The pre-filled message, in the sender's voice. First name only —
 * "Hi Adaeze Okonkwo" reads like a bank. The link sits on its own line
 * so WhatsApp builds the preview card from it.
 */
export function giftMessage(recipientName: string, revealUrl: string): string {
  const firstName = recipientName.trim().split(/\s+/)[0] || recipientName;
  return `${firstName}, I got you something 🎁\n\nOpen it here:\n${revealUrl}`;
}
