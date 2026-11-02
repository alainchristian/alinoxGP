import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertRuleCache } from './alert-rule.cache';
import { AlertService } from './alert.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [AlertsController],
  providers: [AlertRuleCache, AlertService, AlertEvaluatorService],
  exports: [AlertEvaluatorService],
})
export class AlertsModule {}
