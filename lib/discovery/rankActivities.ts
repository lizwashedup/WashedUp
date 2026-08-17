import type { ActivitySignalSummary } from './activitySignals';

export interface RankableActivity<T = unknown> {
  id: string;
  categoryId: string | null;
  cityId: string | null;
  startsAt: string;
  payload: T;
}

export interface ActivityRankWeights {
  categoryAffinity: number;
  cityAffinity: number;
}

export interface RankedActivity<T = unknown> {
  activity: RankableActivity<T>;
  score: number;
  features: {
    categoryAffinity: number;
    cityAffinity: number;
  };
}

const CANDIDATE_KEYS = new Set(['id', 'categoryId', 'cityId', 'startsAt', 'payload']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

function parseCandidate<T>(value: unknown): RankableActivity<T> | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CANDIDATE_KEYS.has(key))) return null;
  if (!isIdentifier(value.id)) return null;
  if (!isNullableIdentifier(value.categoryId) || !isNullableIdentifier(value.cityId)) return null;
  if (!isIdentifier(value.startsAt) || !Number.isFinite(Date.parse(value.startsAt))) return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  return value as unknown as RankableActivity<T>;
}

function validWeights(weights: ActivityRankWeights): boolean {
  return [weights.categoryAffinity, weights.cityAffinity].every(
    (weight) => Number.isFinite(weight) && weight >= 0,
  );
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validCountRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, count]) => isIdentifier(key) && validCount(count));
}

function parseSummary(value: unknown): ActivitySignalSummary | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    !keys.every((key) =>
      key === 'acceptedSignalCount' ||
      key === 'activityCounts' ||
      key === 'categoryCounts' ||
      key === 'cityCounts'
    )
  ) {
    return null;
  }
  if (!validCount(value.acceptedSignalCount)) return null;
  if (!validCountRecord(value.activityCounts)) return null;
  if (!validCountRecord(value.categoryCounts)) return null;
  if (!validCountRecord(value.cityCounts)) return null;
  return value as unknown as ActivitySignalSummary;
}

function countFor(counts: Record<string, number>, id: string | null): number {
  if (!id) return 0;
  const count = counts[id];
  return validCount(count) ? count : 0;
}

export function rankActivities<T>(
  candidates: readonly unknown[],
  rawSummary: unknown,
  weights: ActivityRankWeights,
): RankedActivity<T>[] {
  const summary = parseSummary(rawSummary);
  if (!summary || !validWeights(weights)) return [];

  const ranked: RankedActivity<T>[] = [];
  for (const rawCandidate of candidates) {
    const activity = parseCandidate<T>(rawCandidate);
    if (!activity) continue;
    const features = {
      categoryAffinity: countFor(summary.categoryCounts, activity.categoryId),
      cityAffinity: countFor(summary.cityCounts, activity.cityId),
    };
    ranked.push({
      activity,
      features,
      score:
        features.categoryAffinity * weights.categoryAffinity +
        features.cityAffinity * weights.cityAffinity,
    });
  }

  return ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const timeDifference = Date.parse(left.activity.startsAt) - Date.parse(right.activity.startsAt);
    if (timeDifference !== 0) return timeDifference;
    return left.activity.id.localeCompare(right.activity.id);
  });
}
