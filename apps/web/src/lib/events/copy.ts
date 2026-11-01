import type { EventType } from "./types";

/**
 * The words each kind of event uses. A remembrance never says "spray"
 * or "celebrate", and never shows amounts (the API enforces that too).
 */
export interface EventCopy {
  /** Chip label when creating. */
  label: string;
  /** Eyebrow above the title on the guest page. */
  eyebrow: string;
  /** Prompt for the title field. */
  titleLabel: string;
  titlePlaceholder: string;
  /** The cash tab, button and toggle. */
  cash: string;
  /** The verb on the pay button: "Spray", "Give". */
  cashVerb: string;
  /** The live screen's name. */
  wall: string;
  /** The line under a guest's name on the wall: "sprayed", "gave". */
  wallVerb: string;
  /** Who the gifts are for, in a sentence: "the couple", "the family". */
  whom: string;
}

export const EVENT_COPY: Record<EventType, EventCopy> = {
  wedding: {
    label: "Wedding",
    eyebrow: "The wedding of",
    titleLabel: "Whose wedding?",
    titlePlaceholder: "Tola & Dayo",
    cash: "Spray the couple",
    cashVerb: "Spray",
    wall: "Spray wall",
    wallVerb: "sprayed",
    whom: "the couple",
  },
  engagement: {
    label: "Engagement",
    eyebrow: "The engagement of",
    titleLabel: "Whose engagement?",
    titlePlaceholder: "Tola & Dayo",
    cash: "Spray the couple",
    cashVerb: "Spray",
    wall: "Spray wall",
    wallVerb: "sprayed",
    whom: "the couple",
  },
  birthday: {
    label: "Birthday",
    eyebrow: "Celebrating",
    titleLabel: "Who are we celebrating?",
    titlePlaceholder: "Mama Kemi at 60",
    cash: "Give cash",
    cashVerb: "Give",
    wall: "Celebration wall",
    wallVerb: "gave",
    whom: "the celebrant",
  },
  baby: {
    label: "Baby & naming",
    eyebrow: "Welcoming",
    titleLabel: "Whose baby?",
    titlePlaceholder: "Baby Adeyemi",
    cash: "Give cash",
    cashVerb: "Give",
    wall: "Blessings wall",
    wallVerb: "gave",
    whom: "the family",
  },
  send_forth: {
    label: "Send-forth",
    eyebrow: "Sending forth",
    titleLabel: "Who are we sending forth?",
    titlePlaceholder: "Mr. Bello",
    cash: "Give cash",
    cashVerb: "Give",
    wall: "Thank-you wall",
    wallVerb: "gave",
    whom: "the celebrant",
  },
  remembrance: {
    label: "Remembrance",
    eyebrow: "In loving memory of",
    titleLabel: "In memory of",
    titlePlaceholder: "Pa Adeyemi",
    cash: "Support the family",
    cashVerb: "Give",
    wall: "Condolence wall",
    wallVerb: "sent condolences",
    whom: "the family",
  },
};

export const EVENT_TYPE_ORDER: EventType[] = [
  "wedding",
  "engagement",
  "birthday",
  "baby",
  "send_forth",
  "remembrance",
];

/** "Sat 12 Dec" from "2026-12-12", read as a calendar date (no time zone shift). */
export function formatEventDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
