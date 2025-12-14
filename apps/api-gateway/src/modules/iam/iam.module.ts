import { Module } from '@nestjs/common';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';
import { HttpClientModule } from 'src/common/http-client/http-client.module';

@Module({
  imports: [HttpClientModule],
  controllers: [UserController],
  providers: [UserService],
})
export class IamModule {}
