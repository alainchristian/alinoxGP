import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CAPABILITY_KEYS, type CapabilityKey, type CapabilityRowDto, type CatalogueModelDto, type VariantDto, type VerificationDto } from '@gps/shared';
import { AppException, conflict, notFound } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const modelInclude = {
  manufacturer: { select: { id: true, name: true } },
  variants: { orderBy: { createdAt: 'asc' }, include: { capabilities: true, verifications: { orderBy: { testedAt: 'desc' } } } },
} satisfies Prisma.GpsDeviceModelInclude;
type ModelRow = Prisma.GpsDeviceModelGetPayload<{ include: typeof modelInclude }>;

export const variantLabel = (m: { name: string; manufacturer: { name: string } }, v: { hardwareRevision: string | null; firmwareMin: string | null; firmwareMax: string | null }) => {
  const rev = v.hardwareRevision ? ` rev ${v.hardwareRevision}` : '';
  const fw = v.firmwareMin || v.firmwareMax ? ` (firmware ${v.firmwareMin ?? '…'}–${v.firmwareMax ?? '…'})` : '';
  return `${m.manufacturer.name} ${m.name}${rev}${fw}`;
};

const toVariant = (v: ModelRow['variants'][number], withEvidence: boolean): VariantDto => ({
  id: v.id,
  hardwareRevision: v.hardwareRevision,
  firmwareMin: v.firmwareMin,
  firmwareMax: v.firmwareMax,
  compatibilityStatus: v.compatibilityStatus,
  lastTestedAt: v.lastTestedAt?.toISOString() ?? null,
  notes: v.notes,
  capabilities: v.capabilities
    .map((c): CapabilityRowDto => ({ key: c.capabilityKey as CapabilityKey, support: c.support, evidenceAttribute: c.evidenceAttribute, evidenceNotes: c.evidenceNotes, verifiedAt: c.verifiedAt?.toISOString() ?? null }))
    .sort((a, b) => CAPABILITY_KEYS.indexOf(a.key) - CAPABILITY_KEYS.indexOf(b.key)),
  // Who tested what is staff information; customers see the status and the date only.
  verifications: withEvidence
    ? v.verifications.map((x): VerificationDto => ({ id: x.id, testedAt: x.testedAt.toISOString(), testedByName: x.testedByName, firmwareVersion: x.firmwareVersion, procedure: x.procedure, evidence: x.evidence }))
    : [],
});

export const toModelDto = (m: ModelRow, withEvidence: boolean): CatalogueModelDto => ({
  id: m.id,
  manufacturer: m.manufacturer,
  name: m.name,
  protocol: m.protocol,
  enginePort: m.enginePort,
  networkTechnologies: m.networkTechnologies,
  identifierType: m.identifierType,
  reportingNotes: m.reportingNotes,
  configurationNotes: m.configurationNotes,
  installationRequirements: m.installationRequirements,
  knownLimitations: m.knownLimitations,
  docsUrl: m.docsUrl,
  isListed: m.isListed,
  isSimulatorProfile: m.isSimulatorProfile,
  variants: m.variants.map((v) => toVariant(v, withEvidence)),
});

/** Maps the evidence rules the database enforces (migration device_catalogue) to stable API errors. */
function mapRuleError(err: unknown): never {
  const msg = err instanceof Error ? err.message : '';
  if (/cannot be VERIFIED without a recorded verification/.test(msg)) throw new AppException('VERIFICATION_REQUIRED', 422, 'Record a verification (who, when, firmware, procedure, evidence) before marking a variant as verified');
  if (/simulator profile is not a physical device/.test(msg)) throw new AppException('SIMULATOR_PROFILE_NOT_VERIFIABLE', 422, 'A simulator profile is not a physical device and cannot be marked as verified');
  if (/remote_immobilization can only be marked supported/.test(msg)) throw new AppException('IMMOBILIZATION_NEEDS_VERIFIED_VARIANT', 422, 'Remote immobilization can only be marked supported on a verified variant');
  throw err;
}

/** The device catalogue (ADR-0009). GLOBAL data: customers read the listed models; only platform staff write. */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** What customers may choose from during onboarding: listed models only. */
  async listForCustomers(): Promise<CatalogueModelDto[]> {
    const rows = await this.prisma.gpsDeviceModel.findMany({ where: { isListed: true }, include: modelInclude, orderBy: [{ manufacturer: { name: 'asc' } }, { name: 'asc' }] });
    return rows.map((m) => toModelDto(m, false));
  }

  async listAll(): Promise<CatalogueModelDto[]> {
    const rows = await this.prisma.gpsDeviceModel.findMany({ include: modelInclude, orderBy: [{ manufacturer: { name: 'asc' } }, { name: 'asc' }] });
    return rows.map((m) => toModelDto(m, true));
  }

  private async model(id: string): Promise<CatalogueModelDto> {
    const m = await this.prisma.gpsDeviceModel.findUnique({ where: { id }, include: modelInclude });
    if (!m) throw notFound('CATALOGUE_MODEL_NOT_FOUND');
    return toModelDto(m, true);
  }

  async modelOfVariant(variantId: string): Promise<string> {
    const v = await this.prisma.gpsDeviceVariant.findUnique({ where: { id: variantId }, select: { modelId: true } });
    if (!v) throw notFound('CATALOGUE_VARIANT_NOT_FOUND');
    return v.modelId;
  }

  // ---------------------------------------------------------------- manufacturers

  async listManufacturers() {
    return this.prisma.gpsManufacturer.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, website: true } });
  }

  async createManufacturer(input: { name: string; website?: string | null }) {
    try {
      const row = await this.prisma.gpsManufacturer.create({ data: { name: input.name, website: input.website ?? null } });
      await this.audit.record({ action: 'catalogue.manufacturer_create', targetType: 'gps_manufacturer', targetId: row.id, after: { name: row.name } });
      return { id: row.id, name: row.name, website: row.website };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('MANUFACTURER_NAME_TAKEN', 'A manufacturer with this name already exists');
      throw err;
    }
  }

  // ---------------------------------------------------------------- models

  async createModel(input: Prisma.GpsDeviceModelUncheckedCreateInput): Promise<CatalogueModelDto> {
    try {
      const row = await this.prisma.gpsDeviceModel.create({ data: input });
      await this.audit.record({ action: 'catalogue.model_create', targetType: 'gps_device_model', targetId: row.id, after: { name: row.name, protocol: row.protocol } });
      return this.model(row.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('MODEL_NAME_TAKEN', 'This manufacturer already has a model with this name');
      if ((err as { code?: string }).code === 'P2003') throw notFound('MANUFACTURER_NOT_FOUND');
      throw err;
    }
  }

  async updateModel(id: string, input: Prisma.GpsDeviceModelUncheckedUpdateInput): Promise<CatalogueModelDto> {
    await this.model(id);
    try {
      await this.prisma.gpsDeviceModel.update({ where: { id }, data: input });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('MODEL_NAME_TAKEN', 'This manufacturer already has a model with this name');
      throw err;
    }
    await this.audit.record({ action: 'catalogue.model_update', targetType: 'gps_device_model', targetId: id, after: { changed: Object.keys(input) } });
    return this.model(id);
  }

  // ---------------------------------------------------------------- variants, capabilities, verification

  async createVariant(input: Prisma.GpsDeviceVariantUncheckedCreateInput): Promise<CatalogueModelDto> {
    await this.model(input.modelId);
    try {
      const row = await this.prisma.gpsDeviceVariant.create({ data: input });
      await this.audit.record({ action: 'catalogue.variant_create', targetType: 'gps_device_variant', targetId: row.id, after: { status: row.compatibilityStatus } });
    } catch (err) {
      mapRuleError(err);
    }
    return this.model(input.modelId);
  }

  async updateVariant(id: string, input: Prisma.GpsDeviceVariantUncheckedUpdateInput): Promise<CatalogueModelDto> {
    const modelId = await this.modelOfVariant(id);
    try {
      await this.prisma.gpsDeviceVariant.update({ where: { id }, data: input });
    } catch (err) {
      mapRuleError(err);
    }
    await this.audit.record({ action: 'catalogue.variant_update', targetType: 'gps_device_variant', targetId: id, after: { changed: Object.keys(input) } });
    return this.model(modelId);
  }

  async setCapability(variantId: string, key: CapabilityKey, input: { support: CapabilityRowDto['support']; evidenceAttribute?: string | null; evidenceNotes?: string | null }): Promise<CatalogueModelDto> {
    const modelId = await this.modelOfVariant(variantId);
    const data = { support: input.support, evidenceAttribute: input.evidenceAttribute ?? null, evidenceNotes: input.evidenceNotes ?? null };
    try {
      await this.prisma.variantCapability.upsert({ where: { variantId_capabilityKey: { variantId, capabilityKey: key } }, create: { variantId, capabilityKey: key, ...data }, update: data });
    } catch (err) {
      mapRuleError(err);
    }
    await this.audit.record({ action: 'catalogue.capability_set', targetType: 'gps_device_variant', targetId: variantId, after: { key, support: input.support } });
    return this.model(modelId);
  }

  /** Removing a row returns the capability to UNKNOWN (never to "not supported"). */
  async clearCapability(variantId: string, key: CapabilityKey): Promise<CatalogueModelDto> {
    const modelId = await this.modelOfVariant(variantId);
    await this.prisma.variantCapability.deleteMany({ where: { variantId, capabilityKey: key } });
    await this.audit.record({ action: 'catalogue.capability_clear', targetType: 'gps_device_variant', targetId: variantId, after: { key } });
    return this.model(modelId);
  }

  /** Records a test. It is evidence only: marking the variant VERIFIED is a separate, explicit update (and is refused without this). */
  async addVerification(variantId: string, userId: string | undefined, input: { testedAt: string; testedByName: string; firmwareVersion: string; procedure: string; evidence: string }): Promise<CatalogueModelDto> {
    const modelId = await this.modelOfVariant(variantId);
    const testedAt = new Date(input.testedAt);
    await this.prisma.variantVerification.create({
      data: { variantId, testedAt, testedByUserId: userId ?? null, testedByName: input.testedByName, firmwareVersion: input.firmwareVersion, procedure: input.procedure, evidence: input.evidence },
    });
    const latest = await this.prisma.variantVerification.findFirst({ where: { variantId }, orderBy: { testedAt: 'desc' }, select: { testedAt: true } });
    await this.prisma.gpsDeviceVariant.update({ where: { id: variantId }, data: { lastTestedAt: latest?.testedAt ?? testedAt } });
    await this.audit.record({ action: 'catalogue.verification_add', targetType: 'gps_device_variant', targetId: variantId, after: { firmwareVersion: input.firmwareVersion } });
    return this.model(modelId);
  }
}
