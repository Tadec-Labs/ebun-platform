/** All prices in the schema are kobo (bigint). Formats as e.g. "₦8,000". */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/**
 * Parses what a person types into a naira field ("5,600", "₦5600.50")
 * into integer kobo, or null if it isn't a valid amount. Done on the
 * string rather than via parseFloat * 100, which turns 19.99 into
 * 1998.9999999999998 — fine for display, not for money the API will
 * store and pay out.
 */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
