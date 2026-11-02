/**
 * Operator CLI. Usage:
 *   pnpm --filter @gps/api cli create-super-admin --email you@example.com --name "Your Name"
 *   pnpm --filter @gps/api cli create-sandbox-org --name "Demo sandbox" --owner-email existing.user@example.com
 * The first Super Administrator is created here — never through public registration (ADR-0002).
 * A random one-time password is generated and printed once; change it after the first sign-in.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_KEYS } from '@gps/shared';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function createSuperAdmin() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  if (!email || !name) throw new Error('Usage: create-super-admin --email <email> --name <full name>');
  const url = process.env['DATABASE_URL_SYSTEM'];
  if (!url) throw new Error('DATABASE_URL_SYSTEM is required');

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const platform = await prisma.organization.findFirst({ where: { type: 'PLATFORM' } });
    const role = await prisma.role.findUnique({ where: { key: ROLE_KEYS.PLATFORM_SUPER_ADMIN } });
    if (!platform || !role) throw new Error('Reference data missing. Run the seed first (pnpm db:seed).');
    if (await prisma.user.findUnique({ where: { email } })) throw new Error(`A user with email ${email} already exists.`);

    const password = randomBytes(15).toString('base64url');
    const user = await prisma.user.create({
      data: {
        email,
        fullName: name,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        emailVerifiedAt: new Date(),
      },
    });
    const member = await prisma.organizationMember.create({ data: { organizationId: platform.id, userId: user.id } });
    await prisma.memberRole.create({ data: { organizationId: platform.id, memberId: member.id, roleId: role.id } });
    await prisma.auditLog.create({
      data: { action: 'cli.create_super_admin', actorType: 'SYSTEM', organizationId: platform.id, targetType: 'user', targetId: user.id },
    });
    console.log(`Super Administrator created: ${email}\nOne-time password (shown once): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

/** A sandbox organization is the ONLY place simulated devices may exist (development, demos, sales sandbox). */
async function createSandboxOrg() {
  const name = arg('name')?.trim();
  const ownerEmail = arg('owner-email')?.trim().toLowerCase();
  if (!name || !ownerEmail) throw new Error('Usage: create-sandbox-org --name <name> --owner-email <existing user email>');
  const url = process.env['DATABASE_URL_SYSTEM'];
  if (!url) throw new Error('DATABASE_URL_SYSTEM is required');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
    const role = await prisma.role.findUnique({ where: { key: ROLE_KEYS.ORG_OWNER } });
    if (!owner) throw new Error(`No user with email ${ownerEmail}. Register first.`);
    if (!role) throw new Error('Reference data missing. Run the seed first (pnpm db:seed).');
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { type: 'CUSTOMER', name, isSandbox: true, countryCode: 'RW', timezone: 'Africa/Kigali', currencyCode: 'RWF' },
      });
      const member = await tx.organizationMember.create({ data: { organizationId: created.id, userId: owner.id } });
      await tx.memberRole.create({ data: { organizationId: created.id, memberId: member.id, roleId: role.id } });
      await tx.auditLog.create({ data: { action: 'cli.create_sandbox_org', actorType: 'SYSTEM', organizationId: created.id, targetType: 'organization', targetId: created.id } });
      return created;
    });
    console.log(`Sandbox organization created: ${org.name} (${org.id}). Owner: ${ownerEmail}. Simulated devices (ids starting with SIM-) can be registered here.`);
  } finally {
    await prisma.$disconnect();
  }
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = { 'create-super-admin': createSuperAdmin, 'create-sandbox-org': createSandboxOrg };
const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`Unknown command. Available: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
