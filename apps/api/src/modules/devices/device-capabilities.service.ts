import { Injectable } from '@nestjs/common';
import { effectiveCapabilities, type CapabilityKey, type CapabilityRow, type DeviceCapabilitiesDto } from '@gps/shared';
import { notFound } from '../../common/errors';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import type { LiveState } from '../live-state/live-state';
import { LiveStateStore } from '../live-state/live-state.store';
import { labelOf, variantInclude, type VariantRow } from './device-variant';

/**
 * Effective capabilities of ONE device = catalogue ∧ installation ∧ observed (ADR-0009). Computed on request from the
 * catalogue and the live state (the same inputs the pipeline uses), so it can never drift from them.
 * What it can observe today is only what the live state keeps: position, speed, ignition, motion.
 */
@Injectable()
export class DeviceCapabilitiesService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly store: LiveStateStore,
  ) {}

  /** Pure given its inputs; used for the customer view and for platform diagnostics. */
  compute(deviceId: string, variant: VariantRow | null, state: LiveState | null, now: Date = new Date()): DeviceCapabilitiesDto {
    const rows: Partial<Record<CapabilityKey, CapabilityRow>> = {};
    for (const c of variant?.capabilities ?? []) rows[c.capabilityKey as CapabilityKey] = { support: c.support };
    // `everReported` here means "the platform holds reported data for this device": a device on no vehicle has no live state.
    const capabilities = effectiveCapabilities({
      variant: variant ? { compatibilityStatus: variant.compatibilityStatus } : null,
      rows,
      observation: {
        everReported: !!state,
        positionSeen: !!state && state.latitude !== null && state.longitude !== null && !!state.lastFixAt,
        speedSeen: !!state && state.speedKmh !== null,
        ignitionSeen: !!state && state.ignition !== null,
        motionSeen: !!state && state.motion !== null,
      },
      installationVerified: false, // installation records arrive with M9; until then wiring-dependent capabilities stay unverified
    });
    return {
      deviceId,
      variant: variant ? { id: variant.id, label: labelOf(variant), compatibilityStatus: variant.compatibilityStatus, isSimulatorProfile: variant.model.isSimulatorProfile } : null,
      computedAt: now.toISOString(),
      capabilities,
    };
  }

  async forDevice(organizationId: string, id: string): Promise<DeviceCapabilitiesDto> {
    const device = await this.tenant.run((tx) =>
      tx.gpsDevice.findUnique({
        where: { id },
        include: { variant: { include: variantInclude }, assignments: { where: { unassignedAt: null }, select: { vehicleId: true }, take: 1 } },
      }),
    );
    if (!device) throw notFound('DEVICE_NOT_FOUND');
    const vehicleId = device.assignments[0]?.vehicleId;
    const state = vehicleId ? await this.store.get(organizationId, vehicleId) : null;
    return this.compute(device.id, device.variant, state);
  }
}
