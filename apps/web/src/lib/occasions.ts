/**
 * The six occasions named in the Product Brief's sender flow — nothing
 * added. Order is the display order.
 *
 * NOT sent to the backend: CreateOrderDto has no occasion field, so this
 * is captured client-side and used for two things only — shaping the
 * message placeholder (below) and showing on the review summary.
 * Persisting it (a column + a DTO field) is worth doing eventually for
 * analytics on which occasions drive volume, but it's a schema change and
 * a separate decision, not something to sneak into a UI slice.
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
