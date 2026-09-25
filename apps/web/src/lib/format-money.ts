/** All prices in the schema are kobo (bigint). Formats as e.g. "₦8,000". */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}
