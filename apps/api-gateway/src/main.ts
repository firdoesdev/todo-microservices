import { NestFactory } from '@nestjs/core';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { AppModule } from './modules/app.module';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import 'dotenv/config';

declare module 'fastify' {
  interface FastifyRequest {
    context?: {
      correlationId: string;
      idempotencyKey: string | null;
    };
  }
}

async function bootstrap() {
  // Fastify adapter dengan konfigurasi khusus
  const adapter = new FastifyAdapter({
    // body limit (bytes)
    bodyLimit: Number(process.env.BODY_LIMIT_BYTES ?? 1_000_000), // ~1MB
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
    // trust proxy kalau di belakang nginx / ingress (penting untuk IP & rate limit)
    trustProxy: (process.env.TRUST_PROXY ?? 'true') === 'true',
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  );
  app.setGlobalPrefix('api');
  // Security headers
  await app.register(helmet);

  // Compression
  await app.register(compress);

  // CORS
  const allowed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Rate limit (global)
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT),
    timeWindow: Number(process.env.RATE_TTL_MS ?? 60_000),
    // key generator default: IP
  });

  // Correlation ID + context propagation (Fastify hook)
  // - ensure x-correlation-id exists
  // - expose back in response
  // - store into request "context"
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const correlationId =
        (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
      const idempotencyKey =
        (req.headers['x-idempotency-key'] as string | undefined) ?? null;

      req.context = { correlationId, idempotencyKey };

      reply.header('x-correlation-id', correlationId);

      // Optional: inject into pino log bindings (biar semua log ada correlationId)
      // Fastify logger supports child loggers:
      req.log = req.log.child({ correlationId });
    });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
