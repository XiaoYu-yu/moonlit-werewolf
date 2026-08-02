import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { assertRuntimeConfiguration, configureTrustProxy } from './common/runtime-config.js';

async function bootstrap(): Promise<void> {
  const runtimeConfiguration = assertRuntimeConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(
        ',',
      ),
      credentials: true,
    },
  });
  configureTrustProxy(app, runtimeConfiguration.trustProxyHopCount);
  app.setGlobalPrefix('api/v1');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.API_PORT ?? process.env.PORT ?? 3001),
    runtimeConfiguration.apiHost,
  );
}

void bootstrap();
