import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import axios from 'axios';

@Controller('/iam')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/users')
  async getHello(): Promise<unknown> {
    const response = await axios.get('http://localhost:3001/iam/users');
    return response.data;
  }

  @Get('status')
  getStatus(): string {
    return 'API Gateway is running';
  }
}
