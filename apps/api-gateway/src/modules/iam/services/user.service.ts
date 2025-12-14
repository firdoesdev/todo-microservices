import { Injectable } from '@nestjs/common';
import { HttpClient } from 'src/common/http-client/http-client.service';
import { env } from 'src/common/configs/env';

@Injectable()
export class UserService {
  constructor(private readonly httpClient: HttpClient) {}

  async findAll() {
    // return `This action returns all users`;
    const data = await this.httpClient.get(`${env.IAM_SERVICE_URL}/users`);
    return data;
  }
}
