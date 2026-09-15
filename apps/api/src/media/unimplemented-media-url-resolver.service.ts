import { Injectable, Logger } from '@nestjs/common';
import { MediaUrlResolver } from './media-url-resolver.interface';

/**
 * Default MEDIA_URL_RESOLVER binding until real R2 presigned-URL
 * generation exists. Deliberately does NOT throw the way
 * UnimplementedVtuProviderService does — reveal is the recipient's
 * entire moment with the gift; hard-failing the whole reveal page
 * because playback isn't wired up yet would block testing everything
 * else about the flow. Instead this passes the raw message_url through
 * unchanged and logs a loud warning every time, so it's impossible to
 * miss in logs but doesn't block end-to-end testing of the rest of the
 * reveal/accept/redeem flow.
 *
 * THIS IS NOT SAFE FOR REAL RECIPIENT MESSAGES: if the R2 bucket is
 * actually private (per architecture decisions, it should be), the
 * passthrough URL will simply fail to load in the recipient's browser —
 * or worse, work by accident if the bucket is misconfigured as public.
 * Either way, do not ship this to real users before replacing it with a
 * real presigned-URL implementation.
 */
@Injectable()
export class UnimplementedMediaUrlResolver implements MediaUrlResolver {
  private readonly logger = new Logger(UnimplementedMediaUrlResolver.name);

  resolvePlaybackUrl(privateMessageUrl: string): Promise<string> {
    this.logger.warn(
      'MediaUrlResolver is not implemented — returning the raw (possibly private) ' +
        'message_url unchanged. This will not play back for real recipients if the ' +
        'R2 bucket is actually private. Needs a real R2 presigned-URL implementation ' +
        'before this reaches production.',
    );
    return Promise.resolve(privateMessageUrl);
  }
}
