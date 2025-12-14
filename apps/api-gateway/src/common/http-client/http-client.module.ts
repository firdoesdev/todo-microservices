import { Module } from '@nestjs/common';
import { HttpClient } from './http-client.service';

@Module({
  providers: [HttpClient],
  exports: [HttpClient],
})
export class HttpClientModule {}
