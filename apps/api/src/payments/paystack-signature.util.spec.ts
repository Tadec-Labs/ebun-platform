import { createHmac } from 'crypto';
import { verifyPaystackSignature } from './paystack-signature.util';

const SECRET = 'sk_test_fake_secret_for_testing_only';

function sign(body: Buffer, secret: string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('verifyPaystackSignature', () => {
  it('accepts a genuinely valid signature', () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { id: 1 } }),
    );
    const signature = sign(body, SECRET);

    expect(verifyPaystackSignature(body, signature, SECRET)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { id: 1 } }),
    );
    const signature = sign(body, 'sk_test_wrong_secret');

    expect(verifyPaystackSignature(body, signature, SECRET)).toBe(false);
  });

  it('rejects when the body has been tampered with after signing', () => {
    const originalBody = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { amount: 500000 } }),
    );
    const signature = sign(originalBody, SECRET);
    const tamperedBody = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { amount: 5 } }),
    );

    expect(verifyPaystackSignature(tamperedBody, signature, SECRET)).toBe(
      false,
    );
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}');

    expect(verifyPaystackSignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects a malformed/wrong-length signature header without throwing', () => {
    const body = Buffer.from('{}');

    expect(() =>
      verifyPaystackSignature(body, 'not-a-real-signature', SECRET),
    ).not.toThrow();
    expect(verifyPaystackSignature(body, 'not-a-real-signature', SECRET)).toBe(
      false,
    );
  });
});
