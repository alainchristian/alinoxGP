import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { InvitationsController, MembersController, OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AccessControlModule, UsersModule],
  controllers: [OrganizationsController, MembersController, InvitationsController],
  providers: [OrganizationsService, MembersService, InvitationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
