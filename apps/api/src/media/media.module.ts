import { Module } from '@nestjs/common';
import { MEDIA_URL_RESOLVER } from './media-url-resolver.interface';
import { MessageMediaService } from './message-media.service';
import { R2MediaUrlResolver } from './r2-media-url-resolver.service';

/** Senders' voice and video messages: storing them, and links to play them. */
@Module({
  providers: [
    MessageMediaService,
    { provide: MEDIA_URL_RESOLVER, useClass: R2MediaUrlResolver },
  ],
  exports: [MessageMediaService, MEDIA_URL_RESOLVER],
})
export class MediaModule {}
