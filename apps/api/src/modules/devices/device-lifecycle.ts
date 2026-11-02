import type { Prisma } from '@prisma/client';
import { canTransition, PRE_ACTIVE, type DeviceLifecycleStatus } from '@gps/shared';

/**
 * Lifecycle transitions (ADR-0005 / ADR-0009). ONE place writes `gps_devices.lifecycle_status`, and every change appends
 * a row to `device_status_history`. Callers pass a transaction whose tenant is `organizationId` (RLS), or one that
 * bypasses RLS (system role).
 */
export class LifecycleError extends Error {
  constructor(
    public readonly code: 'DEVICE_NOT_FOUND' | 'INVALID_TRANSITION' | 'TRANSITION_CONFLICT',
    public readonly from?: DeviceLifecycleStatus,
    public readonly to?: DeviceLifecycleStatus,
  ) {
    super(code);
  }
}

export interface TransitionInput {
  deviceId: string;
  organizationId: string;
  to: DeviceLifecycleStatus;
  /** null = the platform itself (e.g. first signal detected). */
  actorUserId: string | null;
  reason: string | null;
}

/** Moves a device along an ALLOWED transition and records it. Compare-and-set: a concurrent change is a conflict, never a silent overwrite. */
export async function transitionDevice(tx: Prisma.TransactionClient, input: TransitionInput): Promise<{ from: DeviceLifecycleStatus; to: DeviceLifecycleStatus }> {
  const device = await tx.gpsDevice.findUnique({ where: { id: input.deviceId }, select: { lifecycleStatus: true } });
  if (!device) throw new LifecycleError('DEVICE_NOT_FOUND');
  const from = device.lifecycleStatus;
  if (!canTransition(from, input.to)) throw new LifecycleError('INVALID_TRANSITION', from, input.to);
  const changed = await tx.gpsDevice.updateMany({ where: { id: input.deviceId, lifecycleStatus: from }, data: { lifecycleStatus: input.to } });
  if (changed.count !== 1) throw new LifecycleError('TRANSITION_CONFLICT', from, input.to);
  await tx.deviceStatusHistory.create({
    data: { organizationId: input.organizationId, deviceId: input.deviceId, fromStatus: from, toStatus: input.to, actorUserId: input.actorUserId, reason: input.reason },
  });
  return { from, to: input.to };
}

/** The first usable position proves the device transmits: any pre-active device becomes ACTIVE. Never touches SUSPENDED / RETIRED. */
export async function activateOnFirstSignal(tx: Prisma.TransactionClient, deviceId: string, organizationId: string): Promise<boolean> {
  const d = await tx.gpsDevice.findUnique({ where: { id: deviceId }, select: { lifecycleStatus: true } });
  if (!d || !PRE_ACTIVE.includes(d.lifecycleStatus)) return false;
  try {
    await transitionDevice(tx, { deviceId, organizationId, to: 'ACTIVE', actorUserId: null, reason: 'First GPS signal received' });
    return true;
  } catch (err) {
    if (err instanceof LifecycleError) return false; // someone else moved it first: nothing to do
    throw err;
  }
}

/** First history row of a new device (`from` is null). */
export async function recordRegistration(tx: Prisma.TransactionClient, input: { deviceId: string; organizationId: string; status: DeviceLifecycleStatus; actorUserId: string | null }) {
  await tx.deviceStatusHistory.create({
    data: { organizationId: input.organizationId, deviceId: input.deviceId, fromStatus: null, toStatus: input.status, actorUserId: input.actorUserId, reason: 'Device registered' },
  });
}
