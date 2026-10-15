import { Injectable } from '@nestjs/common';
import { MediaUrlResolver } from './media-url-resolver.interface';
import { MessageMediaService } from './message-media.service';

/** The real MEDIA_URL_RESOLVER: a presigned GET on the private message bucket. */
@Injectable()
export class R2MediaUrlResolver implements MediaUrlResolver {
  constructor(private readonly media: MessageMediaService) {}

  resolvePlaybackUrl(privateMessageKey: string): Promise<string | null> {
    return this.media.playbackUrl(privateMessageKey);
  }
}
