import { Module } from '@nestjs/common';
import { ConsentAdminController, ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

@Module({ controllers: [ConsentController, ConsentAdminController], providers: [ConsentService], exports: [ConsentService] })
export class ConsentModule {}
