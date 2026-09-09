import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendWhatsappTemplateParams {
  phoneNumber: string;
  /**
   * Positional template variables, per Termii's convention (their own
   * docs example: {"1": "2", "3": "4"}) — WhatsApp Business templates use
   * numbered placeholders tied to the SPECIFIC approved template's
   * content, not named keys. Which numbers mean what is entirely a
   * function of whichever template ends up approved on the Termii
   * dashboard — see this file's header for why that can't be nailed down
   * further from here.
   */
  data: Record<string, string>;
}

export interface SendWhatsappTemplateResult {
  providerMessageId: string;
}

interface TermiiTemplateResponse {
  code: string; // "ok" on success, per docs
  message: string;
  message_id?: string;
  message_id_str?: string;
}

/**
 * Outbound calls to Termii's WhatsApp Template API
 * (https://developer.termii.com/templates, verified current as of this
 * writing). Same module-boundary reasoning as PaystackClientService:
 * this depends on nothing of ours, so NotificationsModule can import it
 * without risking a cycle.
 *
 * WHY THE TEMPLATE ENDPOINT, NOT THE PLAIN "CONVERSATIONAL" ONE:
 * Termii's docs (developer.termii.com/error, "common errors") say a
 * free-form WhatsApp message fails unless the recipient already opened
 * a messaging window by messaging Ebun's WhatsApp number first. Every
 * Ebun recipient's FIRST contact is the gift reveal notification itself
 * — there is no prior inbound message to open that window. The
 * Template API (POST /api/send/template) is Termii's documented path
 * for messaging someone outside that window, which is Ebun's only real
 * option here.
 *
 * WHAT THIS CANNOT KNOW YET, AND WHY:
 * A WhatsApp Business template must be written and approved by Meta
 * before it has a template_id, a device_id (from registering a WhatsApp
 * "device" on the Termii dashboard), or a fixed set of positional
 * variables — none of which can be produced from documentation alone;
 * they only exist once a real Termii account has gone through that
 * setup. TERMII_WHATSAPP_DEVICE_ID/TERMII_WHATSAPP_TEMPLATE_ID are read
 * from config for exactly this reason, and this method throws a clear,
 * actionable error if they're unset rather than silently no-op'ing or
 * guessing values — same "loud failure" bias as
 * UnimplementedVtuProviderService, for the same underlying reason: I
 * don't have a real account to verify this against, so the code says so
 * plainly instead of pretending otherwise.
 *
 * UNVERIFIED AGAINST A LIVE TERMII ACCOUNT. Built strictly from
 * developer.termii.com's published request/response shapes, which are
 * primary-source and currently dated — but no sandbox call has actually
 * been made. Treat this as needing one real smoke test against a real
 * Termii account (with a real approved template) before depending on it
 * in production.
 */
@Injectable()
export class TermiiWhatsappClientService {
  constructor(private readonly config: ConfigService) {}

  async sendTemplateMessage(
    params: SendWhatsappTemplateParams,
  ): Promise<SendWhatsappTemplateResult> {
    const apiKey = this.config.get<string>('TERMII_API_KEY');
    const baseUrl = this.config.get<string>('TERMII_BASE_URL');
    const deviceId = this.config.get<string>('TERMII_WHATSAPP_DEVICE_ID');
    const templateId = this.config.get<string>('TERMII_WHATSAPP_TEMPLATE_ID');

    if (!apiKey || !baseUrl || !deviceId || !templateId) {
      throw new InternalServerErrorException(
        'Termii WhatsApp is not configured yet (need TERMII_API_KEY, ' +
          'TERMII_BASE_URL, TERMII_WHATSAPP_DEVICE_ID, and ' +
          'TERMII_WHATSAPP_TEMPLATE_ID) — a WhatsApp device and an ' +
          'approved message template must exist on the Termii dashboard ' +
          'first. See TermiiWhatsappClientService for why this cannot be ' +
          'guessed at from documentation alone.',
      );
    }

    const response = await fetch(`${baseUrl}/api/send/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        phone_number: params.phoneNumber,
        device_id: deviceId,
        template_id: templateId,
        data: params.data,
      }),
    });

    const body = (await response.json()) as TermiiTemplateResponse;

    if (!response.ok || body.code !== 'ok') {
      throw new BadGatewayException(
        `Termii WhatsApp template send failed: ${body.message ?? response.statusText}`,
      );
    }

    const providerMessageId = body.message_id_str ?? body.message_id;
    if (!providerMessageId) {
      throw new BadGatewayException(
        'Termii reported success but returned no message_id — cannot record delivery tracking.',
      );
    }

    return { providerMessageId };
  }
}
