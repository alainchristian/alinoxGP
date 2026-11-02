import { createZodDto } from 'nestjs-zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  stepUpSchema,
  totpConfirmSchema,
  totpDisableSchema,
  verifyEmailSchema,
} from '@gps/shared';

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
export class ResendVerificationDto extends createZodDto(resendVerificationSchema) {}
export class StepUpDto extends createZodDto(stepUpSchema) {}
export class TotpConfirmDto extends createZodDto(totpConfirmSchema) {}
export class TotpDisableDto extends createZodDto(totpDisableSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
