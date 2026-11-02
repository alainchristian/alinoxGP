import { Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { UsersService } from './users.service';

@Module({ providers: [PasswordService, UsersService], exports: [UsersService] })
export class UsersModule {}
