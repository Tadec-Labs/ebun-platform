import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers';
import { resolvePort } from './config/port';
import { resolveTrustProxyHops } from './config/proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Real client IPs behind Railway's proxy — see config/proxy.ts for why
  // rate limiting and fraud records both depend on this.
  app.set('trust proxy', resolveTrustProxyHops());
  // No framework advertising; nothing for a scanner to fingerprint.
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // apps/web (Vercel) and apps/api (Railway) are different origins, so
  // this is required, not optional — without it every browser request
  // fails with an opaque CORS error rather than anything actionable.
  // Scoped to the real web app origin (already a required env var for
  // reveal links) plus localhost for local dev, not a wildcard: these
  // endpoints create real orders and initiate real payments...
  const configService = app.get(ConfigService);
  // Trailing slash stripped: browsers send Origin without one, so a
  // WEB_APP_BASE_URL set with one would never match and every call would
  // be blocked by CORS with no useful error.
  const webAppBaseUrl = configService
    .get<string>('WEB_APP_BASE_URL')
    ?.replace(/\/+$/, '');
  app.enableCors({
    origin: [webAppBaseUrl, 'http://localhost:3000'].filter(
      (origin): origin is string => Boolean(origin),
    ),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  // Defaults to 3001, not 3000 — see config/port.ts. Hosts inject PORT,
  // so the default is local dev only, where 3000 is Next's dev server
  // and apps/web already calls :3001.
  const port = resolvePort();
  await app.listen(port);
  // Logged because the symptom of getting this wrong is a frontend that
  // shows "couldn't load" with nothing in the API's own output.
  console.log(`Ebun API listening on port ${port}`);
}
void bootstrap();
