import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailPort } from './email.port';

/**
 * DEVELOPMENT ADAPTER — not a real email provider. Logs messages and keeps them in memory so developers
 * and tests can read verification / reset links. Refused in production by environment validation.
 */
@Injectable()
export class DevEmailAdapter implements EmailPort {
  private readonly logger = new Logger('DevEmail');
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger.log(`[DEV EMAIL - not sent] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }

  lastTo(to: string): EmailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}
