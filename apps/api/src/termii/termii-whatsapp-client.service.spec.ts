import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TermiiWhatsappClientService } from './termii-whatsapp-client.service';

const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

interface FakeFetchResponse {
  ok: boolean;
  statusText?: string;
  json: () => Promise<unknown>;
}

function fakeResponse(body: FakeFetchResponse): Response {
  return body as unknown as Response;
}

const CONFIGURED = {
  TERMII_API_KEY: 'termii_test_key',
  TERMII_BASE_URL: 'https://api.ng.termii.com',
  TERMII_WHATSAPP_DEVICE_ID: 'device-123',
  TERMII_WHATSAPP_TEMPLATE_ID: 'template-abc',
};

async function buildSut(
  config: Partial<typeof CONFIGURED>,
): Promise<TermiiWhatsappClientService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TermiiWhatsappClientService,
      {
        provide: ConfigService,
        useValue: { get: (key: keyof typeof CONFIGURED) => config[key] },
      },
    ],
  }).compile();

  return moduleRef.get(TermiiWhatsappClientService);
}

describe('TermiiWhatsappClientService', () => {
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
  });

  it('POSTs to /api/send/template with the documented field names and returns the message id', async () => {
    const sut = await buildSut(CONFIGURED);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 'ok',
            message: 'Successfully Sent',
            message_id_str: '3017544054459083819856413',
          }),
      }),
    );

    const result = await sut.sendTemplateMessage({
      phoneNumber: '2348012345678',
      data: { '1': 'Ada', '2': 'https://app.ebun.ng/reveal/token123' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.ng.termii.com/api/send/template',
      expect.objectContaining({ method: 'POST' }),
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit?.body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody).toEqual({
      api_key: 'termii_test_key',
      phone_number: '2348012345678',
      device_id: 'device-123',
      template_id: 'template-abc',
      data: { '1': 'Ada', '2': 'https://app.ebun.ng/reveal/token123' },
    });

    expect(result).toEqual({ providerMessageId: '3017544054459083819856413' });
  });

  it('throws a clear, actionable error when Termii config is missing, rather than sending a malformed request', async () => {
    const sut = await buildSut({});

    await expect(
      sut.sendTemplateMessage({
        phoneNumber: '2348012345678',
        data: {},
      }),
    ).rejects.toThrow(/not configured yet/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws BadGatewayException when Termii reports a non-"ok" code', async () => {
    const sut = await buildSut(CONFIGURED);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        json: () =>
          Promise.resolve({ code: 'error', message: 'Invalid Sender Id' }),
      }),
    );

    await expect(
      sut.sendTemplateMessage({ phoneNumber: '2348012345678', data: {} }),
    ).rejects.toThrow(/Invalid Sender Id/);
  });

  it('throws BadGatewayException on a non-2xx HTTP response', async () => {
    const sut = await buildSut(CONFIGURED);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        statusText: 'Unauthorized',
        json: () =>
          Promise.resolve({ code: 'error', message: 'No valid API key' }),
      }),
    );

    await expect(
      sut.sendTemplateMessage({ phoneNumber: '2348012345678', data: {} }),
    ).rejects.toThrow(/No valid API key/);
  });
});
