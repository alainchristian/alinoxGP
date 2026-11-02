import type { PrismaClient } from '@prisma/client';

/**
 * Catalogue and consent seed (M5b, ADR-0009). Idempotent.
 *
 * HONESTY: no physical device has been bench-tested, so the catalogue starts with ONE entry: the platform simulator's
 * own profile. It is exercised through the real GPS engine by the simulator scenarios, but it is NOT a physical device and
 * can never be VERIFIED (database rule). Real models are added by platform staff, with their evidence, after bench tests.
 */
export async function seedCatalogue(prisma: PrismaClient): Promise<void> {
  let maker = await prisma.gpsManufacturer.findFirst({ where: { name: 'Platform simulator' } });
  maker ??= await prisma.gpsManufacturer.create({ data: { name: 'Platform simulator' } });

  let model = await prisma.gpsDeviceModel.findFirst({ where: { manufacturerId: maker.id, name: 'OsmAnd simulator profile' } });
  model ??= await prisma.gpsDeviceModel.create({
    data: {
      manufacturerId: maker.id,
      name: 'OsmAnd simulator profile',
      protocol: 'osmand',
      identifierType: 'OTHER',
      networkTechnologies: [],
      isListed: true,
      isSimulatorProfile: true,
      reportingNotes: 'Chosen by the simulator command (default 10 s while moving).',
      configurationNotes: 'Simulated devices are driven by the platform simulator (pnpm sim). Nothing is configured on a physical device. Identifiers start with SIM- and are only accepted in sandbox organizations.',
      knownLimitations: 'Not a physical device: it proves the platform pipeline, not the behaviour of any hardware.',
    },
  });

  let variant = await prisma.gpsDeviceVariant.findFirst({ where: { modelId: model.id } });
  variant ??= await prisma.gpsDeviceVariant.create({
    data: {
      modelId: model.id,
      compatibilityStatus: 'SUPPORTED_UNVERIFIED',
      notes: 'Exercised through the real GPS engine by the simulator scenarios. Not a physical device.',
    },
  });

  // Only what the simulator really delivers through the engine today; everything else stays UNKNOWN (no row).
  const rows = [
    { capabilityKey: 'gps_tracking', evidenceAttribute: 'latitude/longitude' },
    { capabilityKey: 'speed_monitoring', evidenceAttribute: 'speed' },
    { capabilityKey: 'ignition_detection', evidenceAttribute: 'ignition' },
  ];
  for (const r of rows) {
    const data = { support: 'SUPPORTED' as const, evidenceAttribute: r.evidenceAttribute, evidenceNotes: 'Sent by the simulator and read back from the engine in the pipeline tests.' };
    await prisma.variantCapability.upsert({
      where: { variantId_capabilityKey: { variantId: variant.id, capabilityKey: r.capabilityKey } },
      create: { variantId: variant.id, capabilityKey: r.capabilityKey, ...data },
      update: data,
    });
  }

  // A tracking notice must exist for the acknowledgement mechanism to be visible. The wording is a DRAFT (OQ-020, OQ-037):
  // legal review replaces it by publishing a new version.
  const existing = await prisma.consentNotice.findFirst({ where: { kind: 'TRACKING_NOTICE' } });
  if (!existing) {
    await prisma.consentNotice.create({
      data: {
        kind: 'TRACKING_NOTICE',
        version: 1,
        title: 'Vehicle tracking notice',
        body:
          'By registering a tracking device you confirm that you own the vehicle or are authorised by its owner to track it; that the people who drive or use the vehicle have been told that its location is recorded; and that you will use location data only for the purposes you have told them about.\n\nThis wording is a draft and has not been reviewed by a lawyer.',
        status: 'PUBLISHED',
        isDraftWording: true,
        publishedAt: new Date(),
      },
    });
  }
}
