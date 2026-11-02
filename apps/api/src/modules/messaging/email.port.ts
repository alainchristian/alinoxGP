export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Provider abstraction for transactional email (spec §5.2). Real providers arrive in M8. */
export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PORT = Symbol('EMAIL_PORT');
