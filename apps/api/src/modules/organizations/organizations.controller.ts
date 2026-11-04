import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { P } from '@gps/shared';
import { NoTenant, Public, RequirePermissions, RequireStepUp, Authenticated } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { OrganizationsService } from './organizations.service';
import {
  AcceptInvitationExistingDto,
  AcceptInvitationNewUserDto,
  InviteMemberDto,
  LookupInvitationDto,
  PageQueryDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
} from './dto';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../../common/throttle';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Organizations I belong to (and, for provider staff, their provider's customers within their scope). */
  @Get()
  @NoTenant()
  list() {
    return this.orgs.listForUser(this.cls.get('auth')!.userId);
  }

  @Get(':organizationId')
  @RequirePermissions(P.ORGANIZATION_READ)
  get(@Param('organizationId', ParseUUIDPipe) id: string) {
    return this.orgs.getById(id);
  }

  @Patch(':organizationId')
  @RequirePermissions(P.ORGANIZATION_UPDATE)
  update(@Param('organizationId', ParseUUIDPipe) id: string, @Body() body: UpdateOrganizationDto) {
    return this.orgs.update(id, body);
  }
}

@ApiTags('Members')
@Controller('organizations/:organizationId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  @RequirePermissions(P.USERS_READ)
  list(@Query() q: PageQueryDto) {
    return this.members.list(q.page, q.pageSize);
  }

  @Get('invitations')
  @RequirePermissions(P.USERS_READ)
  invitations() {
    return this.members.listInvitations();
  }

  @Post('invitations')
  @RequirePermissions(P.USERS_INVITE)
  invite(@Body() body: InviteMemberDto) {
    return this.members.invite(body.email, body.roleKey);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  @RequirePermissions(P.USERS_INVITE)
  async revokeInvitation(@Param('invitationId', ParseUUIDPipe) invitationId: string) {
    await this.members.revokeInvitation(invitationId);
  }

  @Patch('members/:memberId')
  @RequirePermissions(P.USERS_UPDATE)
  @RequireStepUp()
  update(@Param('memberId', ParseUUIDPipe) memberId: string, @Body() body: UpdateMemberDto) {
    return this.members.update(memberId, body);
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermissions(P.USERS_REMOVE)
  @RequireStepUp()
  async remove(@Param('memberId', ParseUUIDPipe) memberId: string) {
    await this.members.remove(memberId);
  }
}

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post('lookup')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  lookup(@Body() body: LookupInvitationDto) {
    return this.invitations.lookup(body.token);
  }

  @Post('accept')
  @Public()
  @Throttle(AUTH_THROTTLE)
  accept(@Body() body: AcceptInvitationNewUserDto) {
    return this.invitations.acceptNewUser(body.token, body.password, body.fullName);
  }

  @Post('accept-existing')
  @Authenticated()
  @HttpCode(200)
  acceptExisting(@Body() body: AcceptInvitationExistingDto) {
    return this.invitations.acceptExisting(body.token, this.cls.get('auth')!.userId);
  }
}
