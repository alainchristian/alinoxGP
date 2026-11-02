import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ALERT_TYPES, createAlertRuleSchema, overspeedParamsSchema, P, pageQuerySchema, updateAlertRuleSchema, uuidSchema, type AlertRuleDto } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore } from '../../common/request-context';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertRuleCache } from './alert-rule.cache';
import { toAlertDto } from './alert.service';

class AlertsQueryDto extends createZodDto(pageQuerySchema.extend({ vehicleId: uuidSchema.optional(), type: z.enum(ALERT_TYPES).optional() })) {}
class CreateRuleDto extends createZodDto(createAlertRuleSchema) {}
class UpdateRuleDto extends createZodDto(updateAlertRuleSchema) {}

const toRuleDto = (r: Prisma.AlertRuleGetPayload<object>): AlertRuleDto => ({
  id: r.id,
  type: r.type,
  params: r.params as Record<string, unknown>,
  severity: r.severity,
  cooldownSeconds: r.cooldownSeconds,
  enabled: r.enabled,
  createdAt: r.createdAt.toISOString(),
});

@ApiTags('Alerts')
@Controller()
export class AlertsController {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly rules: AlertRuleCache,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get('alerts')
  @RequirePermissions(P.ALERTS_READ)
  async list(@Query() q: AlertsQueryDto) {
    const where: Prisma.AlertWhereInput = { ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}), ...(q.type ? { type: q.type } : {}) };
    const [total, rows] = await this.tenant.run((tx) =>
      Promise.all([
        tx.alert.count({ where }),
        tx.alert.findMany({ where, include: { vehicle: { select: { registrationNumber: true } } }, orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]),
    );
    return new PagedResult(rows.map(toAlertDto), { page: q.page, pageSize: q.pageSize, total });
  }

  @Patch('alerts/:id/acknowledge')
  @RequirePermissions(P.ALERTS_ACKNOWLEDGE)
  async acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    const userId = this.cls.get('tenant')!.userId;
    const updated = await this.tenant.run(async (tx) => {
      const found = await tx.alert.findUnique({ where: { id } });
      if (!found) return null;
      return tx.alert.update({ where: { id }, data: { acknowledgedAt: found.acknowledgedAt ?? new Date(), acknowledgedBy: found.acknowledgedBy ?? userId }, include: { vehicle: { select: { registrationNumber: true } } } });
    });
    if (!updated) throw notFound('ALERT_NOT_FOUND');
    return toAlertDto(updated);
  }

  @Get('alert-rules')
  @RequirePermissions(P.ALERTS_READ)
  async listRules() {
    const rows = await this.tenant.run((tx) => tx.alertRule.findMany({ orderBy: { createdAt: 'asc' } }));
    return rows.map(toRuleDto);
  }

  @Post('alert-rules')
  @RequirePermissions(P.ALERT_RULES_MANAGE)
  async createRule(@Body() body: CreateRuleDto) {
    const ctx = this.cls.get('tenant')!;
    const row = await this.tenant.run((tx) =>
      tx.alertRule.create({
        data: {
          organizationId: ctx.organizationId,
          type: body.type,
          // Normalised (defaults applied) for overspeed; validated by the schema.
          params: body.type === 'OVERSPEED' ? overspeedParamsSchema.parse(body.params) : {},
          severity: body.severity,
          cooldownSeconds: body.cooldownSeconds,
          createdBy: ctx.userId,
        },
      }),
    );
    this.rules.invalidate(ctx.organizationId);
    await this.audit.record({ action: 'alert_rule.create', targetType: 'alert_rule', targetId: row.id, after: { type: row.type, cooldownSeconds: row.cooldownSeconds } });
    return toRuleDto(row);
  }

  @Patch('alert-rules/:id')
  @RequirePermissions(P.ALERT_RULES_MANAGE)
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRuleDto) {
    const row = await this.tenant.run(async (tx) => ((await tx.alertRule.findUnique({ where: { id } })) ? tx.alertRule.update({ where: { id }, data: body }) : null));
    if (!row) throw notFound('ALERT_RULE_NOT_FOUND');
    this.rules.invalidate(this.cls.get('tenant')!.organizationId);
    await this.audit.record({ action: 'alert_rule.update', targetType: 'alert_rule', targetId: id, after: { enabled: body.enabled ?? null, cooldownSeconds: body.cooldownSeconds ?? null } });
    return toRuleDto(row);
  }

  @Delete('alert-rules/:id')
  @HttpCode(204)
  @RequirePermissions(P.ALERT_RULES_MANAGE)
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    const res = await this.tenant.run((tx) => tx.alertRule.deleteMany({ where: { id } }));
    if (res.count === 0) throw notFound('ALERT_RULE_NOT_FOUND');
    this.rules.invalidate(this.cls.get('tenant')!.organizationId);
    await this.audit.record({ action: 'alert_rule.delete', targetType: 'alert_rule', targetId: id });
  }
}
