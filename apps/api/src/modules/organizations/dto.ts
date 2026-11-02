import { createZodDto } from 'nestjs-zod';
import {
  acceptInvitationExistingSchema,
  acceptInvitationNewUserSchema,
  createOrganizationSchema,
  inviteMemberSchema,
  lookupInvitationSchema,
  pageQuerySchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@gps/shared';

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}
export class InviteMemberDto extends createZodDto(inviteMemberSchema) {}
export class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
export class LookupInvitationDto extends createZodDto(lookupInvitationSchema) {}
export class AcceptInvitationNewUserDto extends createZodDto(acceptInvitationNewUserSchema) {}
export class AcceptInvitationExistingDto extends createZodDto(acceptInvitationExistingSchema) {}
export class PageQueryDto extends createZodDto(pageQuerySchema) {}
