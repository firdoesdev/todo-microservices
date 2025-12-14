import { Controller, Get } from '@nestjs/common';
import { UserService } from '../services/user.service';

@Controller('iam/users')
export class UserController {
  constructor(private userService: UserService) {}
  @Get()
  getUsers() {
    return this.userService.findAll();
  }
}
