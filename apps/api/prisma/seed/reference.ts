import type { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@gps/shared';
import { seedCatalogue } from './catalogue';

/**
 * Idempotent reference data: countries, currencies, permission catalogue, system roles and their
 * permission bundles, and the single PLATFORM organization. Safe to run repeatedly (upserts / syncs).
 * Run with the system role (needs to write roles/permissions, which the app role may not need to).
 */
export async function seedReference(prisma: PrismaClient): Promise<void> {
  const currencies = [
    { code: 'RWF', name: 'Rwandan franc', symbol: 'FRw', minorUnitExp: 0 },
    { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh', minorUnitExp: 2 },
    { code: 'UGX', name: 'Ugandan shilling', symbol: 'USh', minorUnitExp: 0 },
    { code: 'TZS', name: 'Tanzanian shilling', symbol: 'TSh', minorUnitExp: 2 },
    { code: 'USD', name: 'US dollar', symbol: '$', minorUnitExp: 2 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  // Countries are configuration, not code: only Rwanda is enabled at launch (spec §3.1).
  const countries = [
    { code: 'RW', name: 'Rwanda', dialCode: '+250', defaultCurrency: 'RWF', defaultTimezone: 'Africa/Kigali', enabled: true },
    { code: 'KE', name: 'Kenya', dialCode: '+254', defaultCurrency: 'KES', defaultTimezone: 'Africa/Nairobi', enabled: false },
    { code: 'UG', name: 'Uganda', dialCode: '+256', defaultCurrency: 'UGX', defaultTimezone: 'Africa/Kampala', enabled: false },
    { code: 'TZ', name: 'Tanzania', dialCode: '+255', defaultCurrency: 'TZS', defaultTimezone: 'Africa/Dar_es_Salaam', enabled: false },
  ];
  for (const c of countries) {
    // `enabled` is operator-controlled after the first seed: do not overwrite it on re-runs.
    const { enabled, ...rest } = c;
    await prisma.country.upsert({ where: { code: c.code }, update: rest, create: { ...rest, enabled } });
  }

  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, scope: def.scope, isSystem: true },
      create: { key: def.key, name: def.name, description: def.description, scope: def.scope, isSystem: true },
    });
    const wanted = new Set(def.permissions.map((k) => permissionIds.get(k)!));
    const existing = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const stale = existing.filter((e) => !wanted.has(e.permissionId)).map((e) => e.permissionId);
    if (stale.length) await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: stale } } });
    const have = new Set(existing.map((e) => e.permissionId));
    const missing = [...wanted].filter((id) => !have.has(id));
    if (missing.length) {
      await prisma.rolePermission.createMany({ data: missing.map((permissionId) => ({ roleId: role.id, permissionId })) });
    }
  }

  const platform = await prisma.organization.findFirst({ where: { type: 'PLATFORM' } });
  if (!platform) {
    await prisma.organization.create({
      data: { type: 'PLATFORM', name: 'GPS Platform', countryCode: 'RW', timezone: 'Africa/Kigali', currencyCode: 'RWF' },
    });
  }

  await seedCatalogue(prisma);
}
