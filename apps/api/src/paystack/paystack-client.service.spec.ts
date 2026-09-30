import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaystackClientService } from './paystack-client.service';

// Properly typed against the real fetch signature — a plain jest.fn() leaves .mock.calls[n] typed `any`, which trips @typescript-eslint/no-unsafe-assignment when inspecting the sent request body below.
const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

interface FakeFetchResponse {
  ok: boolean;
  statusText?: string;
  json: () => Promise<unknown>;
}

function fakeResponse(body: FakeFetchResponse): Response {
  return body as unknown as Response;
}

describe('PaystackClientService', () => {
  let sut: PaystackClientService;

  beforeEach(async () => {
    global.fetch = fetchMock;
    fetchMock.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaystackClientService,
        {
          provide: ConfigService,
          useValue: {
            // Key-aware: the previous `() => 'sk_test_fake'` returned the
            // same value for every key, which would have silently turned
            // WEB_APP_BASE_URL into "sk_test_fake" in the callback URL.
            getOrThrow: (key: string) =>
              key === 'WEB_APP_BASE_URL'
                ? 'https://ebun.example'
                : 'sk_test_fake',
          },
        },
      ],
    }).compile();

    sut = moduleRef.get(PaystackClientService);
  });

  it('sends amount/email/reference/currency and returns the parsed checkout details on success', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            message: 'Authorization URL created',
            data: {
              authorization_url: 'https://checkout.paystack.com/abc123',
              access_code: 'access_code_123',
              reference: 'ebun_ref_123',
            },
          }),
      }),
    );

    const result = await sut.initializeTransaction({
      email: 'sender@example.com',
      amountKobo: 500000,
      reference: 'ebun_ref_123',
      metadata: { orderId: 'order-1' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's expect.objectContaining() typing against RequestInit's HeadersInit union resolves to `any` here; this is test-assertion code, not production logic, and the actual assertion below still checks a concrete value.
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_fake',
        }),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit?.body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody).toEqual({
      email: 'sender@example.com',
      amount: 500000,
      reference: 'ebun_ref_123',
      currency: 'NGN',
      callback_url: 'https://ebun.example/send/confirmation',
      metadata: { orderId: 'order-1' },
    });

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc123',
      accessCode: 'access_code_123',
      reference: 'ebun_ref_123',
    });
  });

  it('does not double the slash when WEB_APP_BASE_URL has a trailing one', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaystackClientService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              key === 'WEB_APP_BASE_URL'
                ? 'https://ebun.example/'
                : 'sk_test_fake',
          },
        },
      ],
    }).compile();
    const client = moduleRef.get(PaystackClientService);

    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            message: 'ok',
            data: {
              authorization_url: 'https://checkout.paystack.com/x',
              access_code: 'a',
              reference: 'r',
            },
          }),
      }),
    );

    await client.initializeTransaction({
      email: 'x@example.com',
      amountKobo: 1000,
      reference: 'r',
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit?.body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody.callback_url).toBe(
      'https://ebun.example/send/confirmation',
    );
  });

  it('throws BadGatewayException when Paystack reports status: false', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        json: () => Promise.resolve({ status: false, message: 'Invalid key' }),
      }),
    );

    await expect(
      sut.initializeTransaction({
        email: 'x@example.com',
        amountKobo: 1000,
        reference: 'ref',
      }),
    ).rejects.toThrow(
      'Paystack transaction initialization failed: Invalid key',
    );
  });

  it('throws BadGatewayException on a non-2xx HTTP response', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        statusText: 'Unauthorized',
        json: () =>
          Promise.resolve({ status: false, message: 'Invalid API key' }),
      }),
    );

    await expect(
      sut.initializeTransaction({
        email: 'x@example.com',
        amountKobo: 1000,
        reference: 'ref',
      }),
    ).rejects.toThrow(/Invalid API key/);
  });
});
