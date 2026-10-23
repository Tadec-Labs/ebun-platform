import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompanySignupService } from './company-signup.service';
import {
  ResendCompanyLinksDto,
  StartCompanyCampaignDto,
} from './dto/company-signup.dto';

/**
 * The public front door for companies. No auth: anyone can ask, and the
 * answer is always an email to the address they gave.
 *
 * Separate from CampaignPortalController on purpose — that one is
 * entirely behind the portal-token guard, and nothing here should ever
 * sit behind it or beside it.
 *
 * Throttled hard (5 an hour per IP): every call sends an email from our
 * domain, and that reputation is worth more than a fast retry.
 * Off unless CORPORATE_SELF_SERVE=true.
 */
@Controller('companies')
@Throttle({ default: { limit: 5, ttl: 3_600_000 } })
export class CompanySignupController {
  constructor(private readonly signup: CompanySignupService) {}

  @Post('start')
  @HttpCode(202)
  start(@Body() dto: StartCompanyCampaignDto) {
    this.requireEnabled();
    return this.signup.start(dto);
  }

  @Post('links')
  @HttpCode(202)
  links(@Body() dto: ResendCompanyLinksDto) {
    this.requireEnabled();
    return this.signup.resendLinks(dto);
  }

  private requireEnabled(): void {
    if (!this.signup.isEnabled()) throw new NotFoundException();
  }
}
