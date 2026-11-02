import { Global, Module } from '@nestjs/common';
import { DevEmailAdapter } from './dev-email.adapter';
import { EMAIL_PORT } from './email.port';

@Global()
@Module({
  providers: [DevEmailAdapter, { provide: EMAIL_PORT, useExisting: DevEmailAdapter }],
  exports: [EMAIL_PORT, DevEmailAdapter],
})
export class MessagingModule {}
