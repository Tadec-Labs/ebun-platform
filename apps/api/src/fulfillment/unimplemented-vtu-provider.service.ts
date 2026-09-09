import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  VtuProviderService,
  VtuTopUpParams,
  VtuTopUpResult,
} from './vtu-provider.interface';

/**
 * Default VTU_PROVIDER binding until a real Nellobytes/Shago/BuyPower
 * client is built. Throws clearly and immediately rather than the
 * orchestrator silently marking a VTU order "complete" without ever
 * having actually topped anyone up — a stub that pretended to succeed
 * would be far more dangerous than one that fails loudly, given this
 * is a money-touching gift that a real recipient is waiting on.
 *
 * The order is left at `fulfillment_in_progress` with a gift_fulfillments
 * row already recording the (unused) vtu_request_id — see
 * FulfillmentOrchestratorService for why persisting that request id
 * before this call matters even though this implementation never uses
 * it yet.
 */
@Injectable()
export class UnimplementedVtuProviderService implements VtuProviderService {
  topUp(params: VtuTopUpParams): Promise<VtuTopUpResult> {
    throw new NotImplementedException(
      'VTU provider integration (Nellobytes/Shago/BuyPower) is not built yet. ' +
        'The order is left at fulfillment_in_progress pending manual fulfillment or the real provider client. ' +
        `Requested top-up: requestId=${params.requestId}, amountKobo=${params.amountKobo}.`,
    );
  }
}
