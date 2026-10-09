/**
 * The six occasions named in the Product Brief's sender flow — nothing
 * added. Order is the display order.
 *
 * NOT sent to the backend: CreateOrderDto has no occasion field. It now
 * does exactly one job — shaping the message placeholder below — and the
 * UI reflects that: it used to be the sender flow's first screen, a full
 * gate that cost a decision and returned nothing, and it is now a row of
 * prompts beside the message box.
 *
 * If an occasion column and DTO field are ever added, this becomes real
 * data worth asking for, and earns a more prominent place back. Until
 * then it is a writing aid, and is presented as one.
 */
export const OCCASIONS = [
  { id: "birthday", label: "Birthday" },
  { id: "anniversary", label: "Anniversary" },
  { id: "new_baby", label: "New Baby" },
  { id: "promotion", label: "Promotion" },
  { id: "apology", label: "Apology" },
  { id: "just_because", label: "Just Because" },
] as const;

export type OccasionId = (typeof OCCASIONS)[number]["id"];

export function getOccasionLabel(id: OccasionId | null): string | null {
  return OCCASIONS.find((o) => o.id === id)?.label ?? null;
}

const DEFAULT_PLACEHOLDER = "Write what you'd say if you were there...";

/**
 * A starting thought for the message box, shown as a *placeholder* —
 * never pre-filled as real text. A sender who taps Continue without
 * typing must not end up sending words they never wrote; the blank-page
 * problem is solved by showing a prompt, not by putting words in their
 * mouth.
 */
export function messagePlaceholder(
  occasion: OccasionId | null,
  recipientName: string,
): string {
  const name = recipientName.trim();
  const to = name ? `, ${name}` : "";

  switch (occasion) {
    case "birthday":
      return `Happy birthday${to}! Here's a little something to make today even better…`;
    case "anniversary":
      return `Happy anniversary${to}! Here's to another year — and many more…`;
    case "new_baby":
      return `Congratulations${to}! Something to keep you going while you welcome the little one…`;
    case "promotion":
      return `Congratulations${to} — you earned this. Celebrate it properly…`;
    case "apology":
      return `I'm sorry${to}. I wanted to show it, not just say it…`;
    case "just_because":
      return `No reason at all${to} — I just thought of you…`;
    default:
      return DEFAULT_PLACEHOLDER;
  }
}
