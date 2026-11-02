import type { EmailMessage } from './email.port';

type Template = Pick<EmailMessage, 'subject' | 'text'>;

export const verifyEmailTemplate = (baseUrl: string, token: string, fullName: string): Template => ({
  subject: 'Verify your email address',
  text: `Hello ${fullName},\n\nConfirm your email address to activate your account:\n${baseUrl}/verify-email?token=${token}\n\nIf you did not create an account you can ignore this message.`,
});

export const alreadyRegisteredTemplate = (baseUrl: string): Template => ({
  subject: 'Sign-up attempt with your email address',
  text: `Someone tried to create an account with this email address, but an account already exists.\nIf this was you, sign in or reset your password:\n${baseUrl}/forgot-password\n\nIf it was not you, no action is needed.`,
});

export const resetPasswordTemplate = (baseUrl: string, token: string): Template => ({
  subject: 'Reset your password',
  text: `Use this link to choose a new password (valid for a limited time):\n${baseUrl}/reset-password?token=${token}\n\nIf you did not request this you can ignore this message. Your password will not change.`,
});

export const invitationTemplate = (baseUrl: string, token: string, organizationName: string, inviter: string): Template => ({
  subject: `You have been invited to ${organizationName}`,
  text: `${inviter} invited you to join ${organizationName}.\n\nAccept the invitation:\n${baseUrl}/accept-invitation?token=${token}\n\nThe invitation expires automatically.`,
});
