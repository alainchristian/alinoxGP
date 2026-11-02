import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { FanoutService } from './fanout.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, AccessControlModule],
  providers: [RealtimeGateway, FanoutService],
  exports: [FanoutService, RealtimeGateway],
})
export class RealtimeModule {}
