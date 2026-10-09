import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { resolvePort } from './config/port';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

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
  console.log(`Ebun API listening on http://localhost:${port}`);
}
void bootstrap();
