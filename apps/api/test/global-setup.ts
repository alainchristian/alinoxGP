import { execSync } from 'node:child_process';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import Redis from 'ioredis';
import { TEST_STACK } from './setup-env';

/**
 * Runs once before the e2e suites: applies the real migrations (not `db push`), then WIPES everything left by previous runs
 * (tenant data, engine devices, Redis) so every run starts clean, and seeds reference data.
 *
 * Because it deletes data it refuses to run against anything but the isolated test stack (infra/docker-compose.test.yml).
 */
export default async function globalSetup() {
  assertIsolatedTestStack();
  const env = { ...process.env };
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env, cwd: process.cwd() });

  await wipeTenantData();
  await wipeEngineDevices();
  await wipeRedis();

  execSync('npx tsx prisma/seed/index.ts', { stdio: 'pipe', env, cwd: process.cwd() });
}

function assertIsolatedTestStack() {
  const db = new URL(process.env.DATABASE_URL_MIGRATE!);
  const redis = new URL(process.env.REDIS_URL!);
  const traccar = new URL(process.env.TRACCAR_URL!);
  const problems: string[] = [];
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== String(TEST_STACK.postgresPort) || db.pathname !== '/gps_test') {
    problems.push(`database ${db.hostname}:${db.port}${db.pathname} is not the test stack (localhost:${TEST_STACK.postgresPort}/gps_test)`);
  }
  if (!['localhost', '127.0.0.1'].includes(redis.hostname) || redis.port !== String(TEST_STACK.redisPort)) {
    problems.push(`redis ${redis.hostname}:${redis.port} is not the test stack (localhost:${TEST_STACK.redisPort})`);
  }
  if (traccar.port !== new URL(TEST_STACK.traccarRest).port) problems.push(`traccar ${traccar.host} is not the test stack (${new URL(TEST_STACK.traccarRest).host})`);
  if (problems.length > 0) {
    throw new Error(`Refusing to wipe test data: ${problems.join('; ')}. Tests must run against the isolated stack — start it with "pnpm test:infra:up".`);
  }
}

/** Truncates all tenant data (superuser: the application roles are deliberately unable to delete append-only history). */
async function wipeTenantData() {
  const PrismaClient = await importPrismaClientWithoutDotenvLeak();
  const admin = new PrismaClient({ datasourceUrl: `postgresql://postgres:postgres_dev@localhost:${TEST_STACK.postgresPort}/gps_test` });
  try {
    await admin.$executeRawUnsafe('TRUNCATE TABLE organizations, users, consent_notices, variant_capabilities, variant_verifications, gps_device_variants, gps_device_models, gps_manufacturers RESTART IDENTITY CASCADE');
  } finally {
    await admin.$disconnect();
  }
}

/** Removes every device from the TEST Traccar (it exists only for tests), so reconciliation and backfill start small. */
async function wipeEngineDevices() {
  const user = process.env.TRACCAR_USER;
  const password = process.env.TRACCAR_PASSWORD;
  if (!user || !password) throw new Error('TRACCAR_USER/TRACCAR_PASSWORD for the test stack are missing — run "pnpm test:infra:up" (it writes apps/api/.env.test).');
  const base = process.env.TRACCAR_URL!;
  const login = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: user, password }),
  });
  if (!login.ok) throw new Error(`Cannot log in to the test Traccar (HTTP ${login.status}). Run "pnpm test:reset" to rebuild the test stack.`);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const devices = (await (await fetch(`${base}/api/devices`, { headers: { cookie, accept: 'application/json' } })).json()) as { id: number }[];
  for (let i = 0; i < devices.length; i += 20) {
    await Promise.all(devices.slice(i, i + 20).map((d) => fetch(`${base}/api/devices/${d.id}`, { method: 'DELETE', headers: { cookie } })));
  }
}

async function wipeRedis() {
  const redis = new Redis(process.env.REDIS_URL!);
  try {
    await redis.flushall();
  } finally {
    redis.disconnect();
  }
}

/**
 * Importing @prisma/client loads apps/api/.env (the DEVELOPMENT configuration: throttle limits, secrets, URLs) into
 * process.env, and Jest's workers inherit this process's environment. Take the import, then remove whatever it added.
 */
async function importPrismaClientWithoutDotenvLeak(): Promise<typeof PrismaClientType> {
  const before = new Set(Object.keys(process.env));
  const { PrismaClient } = await import('@prisma/client');
  for (const key of Object.keys(process.env)) if (!before.has(key)) delete process.env[key];
  return PrismaClient;
}
