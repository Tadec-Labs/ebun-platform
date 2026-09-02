import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies a Paystack webhook signature: HMAC-SHA512 of the raw request body, keyed with the Paystack secret key, hex-encoded, compared against the `x-paystack-signature` header.
 
 * Takes the RAW body Buffer, not the parsed JSON object — this matters.

 * Re-serializing a parsed body with JSON.stringify() is not guaranteed to byte-for-byte match what Paystack originally sent (key order,
  whitespace), which would make the HMAC comparison fail even for a genuine, unmodified request. See main.ts's `rawBody: true` and the controller's use of `RawBodyRequest` for how the raw bytes are captured before Express's JSON body-parser consumes them.
 
 * Uses timingSafeEqual rather than `===` — a standard precaution against timing attacks on signature comparison, even though the practical risk here is low.
 */

export function verifyPaystackSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expectedHex = createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const providedBuffer = Buffer.from(signatureHeader, 'hex');

  // timingSafeEqual throws on mismatched lengths rather than returning false — guard explicitly so a malformed/truncated header can't crash the request instead of just failing verification.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
