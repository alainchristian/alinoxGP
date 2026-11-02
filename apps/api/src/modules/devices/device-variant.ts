import type { Prisma } from '@prisma/client';
import { isValidImei } from '@gps/shared';
import { AppException } from '../../common/errors';

export const variantInclude = {
  model: { include: { manufacturer: { select: { id: true, name: true } } } },
  capabilities: true,
} satisfies Prisma.GpsDeviceVariantInclude;
export type VariantRow = Prisma.GpsDeviceVariantGetPayload<{ include: typeof variantInclude }>;

/** "Maker Model rev X (firmware A–B)" — the label shown for an identified device. */
export function labelOf(v: VariantRow): string {
  const rev = v.hardwareRevision ? ` rev ${v.hardwareRevision}` : '';
  const fw = v.firmwareMin || v.firmwareMax ? ` (firmware ${v.firmwareMin ?? '…'}–${v.firmwareMax ?? '…'})` : '';
  return `${v.model.manufacturer.name} ${v.model.name}${rev}${fw}`;
}

/**
 * A device may only be identified as a variant its identifier fits: a simulator profile goes with simulated identifiers
 * (SIM-…) and nothing else, and a model that uses an IMEI needs a valid one (15 digits, correct check digit).
 */
export function assertVariantFits(uniqueId: string, variant: VariantRow): void {
  const simulated = uniqueId.startsWith('SIM-');
  if (variant.model.isSimulatorProfile !== simulated) {
    throw new AppException(
      'VARIANT_IDENTIFIER_MISMATCH',
      422,
      simulated ? 'Simulated identifiers (SIM-…) can only use the simulator profile' : 'The simulator profile can only be used with simulated identifiers (SIM-…)',
    );
  }
  if (variant.model.identifierType === 'IMEI' && !isValidImei(uniqueId)) {
    throw new AppException('VALIDATION_FAILED', 400, 'Invalid device identifier', undefined, [{ path: 'uniqueId', message: 'This is not a valid IMEI (15 digits with a correct check digit)' }]);
  }
}
