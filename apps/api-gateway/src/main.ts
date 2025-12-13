import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.log('Starting API Gateway...');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api');
  await app.listen(process.env.API_GATEWAY_PORT ?? 3000);

  logger.log(
    `API Gateway is running on port ${process.env.API_GATEWAY_PORT ?? 3000}`,
  );
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
