import { NestFactory } from '@nestjs/core';
import {Logger} from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.API_GATEWAY_PORT ?? 3000);
}
bootstrap();
