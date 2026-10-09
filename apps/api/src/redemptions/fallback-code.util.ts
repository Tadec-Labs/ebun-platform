/**
 * The human-typed half of redemption. The QR payload is the
 * redemption_token (a UUID, never in a URL — see
 * redemptions.controller.ts); fallback_code is what a recipient reads
 * off their screen for someone to type in when scanning isn't an
 * option, which today is every redemption, since no scanner exists yet.
 *
 * Alphabet and shape mirror generate_fallback_code() in the schema
 * exactly: 'EBN-' plus six characters drawn from a set that omits
 * 0/O/1/I precisely because they get misread aloud and mistyped. No
 * character substitution is attempted on input for the same reason —
 * since none of those four can appear in a real code, a code
 * containing one was misheard rather than mistyped, and silently
 * "correcting" it would turn one person's code into another's.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = new RegExp(`^EBN-[${CODE_ALPHABET}]{6}$`);

/**
 * Accepts what a person would plausibly type — 'ebn-4m8k2l',
 * 'EBN 4M8K2L', '4m8k2l' — and returns the canonical 'EBN-4M8K2L', or
 * null if it could not be a real code.
 *
 * Validating the shape before touching the database is deliberate: it
 * keeps this endpoint from being usable as a free-form probe of the
 * redemptions table, and it gives ops "that isn't an Ebun code" rather
 * than "not found", which are genuinely different problems.
 */
export function normaliseFallbackCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('EBN') ? compact.slice(3) : compact;
  const candidate = `EBN-${body}`;
  return CODE_PATTERN.test(candidate) ? candidate : null;
}
