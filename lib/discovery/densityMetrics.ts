export interface DensityObservation {
  cityId: string;
  dimension: string;
  eligibleAudienceCount: number;
  impressionCount: number;
  conversionCount: number;
}

export interface DensitySummary extends DensityObservation {
  conversionRate: number | null;
}

export interface DensityFloor {
  minimumEligibleAudience: number;
  minimumImpressions: number;
  minimumConversionRate: number;
}

const OBSERVATION_KEYS = new Set([
  'cityId',
  'dimension',
  'eligibleAudienceCount',
  'impressionCount',
  'conversionCount',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseObservation(value: unknown): DensityObservation | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => OBSERVATION_KEYS.has(key))) return null;
  if (!isIdentifier(value.cityId) || !isIdentifier(value.dimension)) return null;
  if (!isCount(value.eligibleAudienceCount) || !isCount(value.impressionCount) || !isCount(value.conversionCount)) {
    return null;
  }
  if (value.conversionCount > value.impressionCount) return null;
  return value as unknown as DensityObservation;
}

export function aggregateDensity(rawObservations: readonly unknown[]): DensitySummary[] | null {
  const grouped = new Map<string, DensityObservation>();
  for (const rawObservation of rawObservations) {
    const observation = parseObservation(rawObservation);
    if (!observation) return null;
    const key = `${observation.cityId}\u0000${observation.dimension}`;
    const current = grouped.get(key) ?? {
      cityId: observation.cityId,
      dimension: observation.dimension,
      eligibleAudienceCount: 0,
      impressionCount: 0,
      conversionCount: 0,
    };
    current.eligibleAudienceCount += observation.eligibleAudienceCount;
    current.impressionCount += observation.impressionCount;
    current.conversionCount += observation.conversionCount;
    if (
      !Number.isSafeInteger(current.eligibleAudienceCount) ||
      !Number.isSafeInteger(current.impressionCount) ||
      !Number.isSafeInteger(current.conversionCount)
    ) {
      return null;
    }
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      conversionRate: entry.impressionCount === 0 ? null : entry.conversionCount / entry.impressionCount,
    }))
    .sort((left, right) =>
      left.cityId === right.cityId
        ? left.dimension.localeCompare(right.dimension)
        : left.cityId.localeCompare(right.cityId),
    );
}

export function meetsDensityFloor(summary: DensitySummary, floor: DensityFloor): boolean {
  const expectedConversionRate = summary.impressionCount === 0
    ? null
    : summary.conversionCount / summary.impressionCount;
  if (
    !isIdentifier(summary.cityId) ||
    !isIdentifier(summary.dimension) ||
    !isCount(summary.eligibleAudienceCount) ||
    !isCount(summary.impressionCount) ||
    !isCount(summary.conversionCount) ||
    summary.conversionCount > summary.impressionCount ||
    (summary.conversionRate !== null &&
      (!Number.isFinite(summary.conversionRate) || summary.conversionRate < 0 || summary.conversionRate > 1)) ||
    summary.conversionRate !== expectedConversionRate ||
    !isCount(floor.minimumEligibleAudience) ||
    !isCount(floor.minimumImpressions) ||
    !Number.isFinite(floor.minimumConversionRate) ||
    floor.minimumConversionRate < 0 ||
    floor.minimumConversionRate > 1 ||
    summary.conversionRate === null
  ) {
    return false;
  }
  return summary.eligibleAudienceCount >= floor.minimumEligibleAudience &&
    summary.impressionCount >= floor.minimumImpressions &&
    summary.conversionRate >= floor.minimumConversionRate;
}
