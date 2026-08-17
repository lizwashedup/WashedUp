export type AlertCandidateKind = 'activity' | 'community';

export interface AreaInterest {
  id: string;
  active: boolean;
  cityIds: readonly string[];
  neighborhoodIds: readonly string[];
  categoryIds: readonly string[];
}

export interface AlertCandidate {
  kind: AlertCandidateKind;
  id: string;
  cityId: string;
  neighborhoodId: string | null;
  categoryId: string | null;
}

export type AlertEligibility =
  | { eligible: true; dedupeKey: string }
  | {
      eligible: false;
      reason:
        | 'invalid_input'
        | 'inactive_interest'
        | 'city_mismatch'
        | 'neighborhood_mismatch'
        | 'category_mismatch'
        | 'already_notified';
    };

const INTEREST_KEYS = new Set(['id', 'active', 'cityIds', 'neighborhoodIds', 'categoryIds']);
const CANDIDATE_KEYS = new Set(['kind', 'id', 'cityId', 'neighborhoodId', 'categoryId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isIdentifier);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function parseInterest(value: unknown): AreaInterest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, INTEREST_KEYS)) return null;
  if (!isIdentifier(value.id) || typeof value.active !== 'boolean') return null;
  if (!isIdentifierArray(value.cityIds) || value.cityIds.length === 0) return null;
  if (!isIdentifierArray(value.neighborhoodIds) || !isIdentifierArray(value.categoryIds)) return null;
  return value as unknown as AreaInterest;
}

function parseCandidate(value: unknown): AlertCandidate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CANDIDATE_KEYS)) return null;
  if (value.kind !== 'activity' && value.kind !== 'community') return null;
  if (!isIdentifier(value.id) || !isIdentifier(value.cityId)) return null;
  if (value.neighborhoodId !== null && !isIdentifier(value.neighborhoodId)) return null;
  if (value.categoryId !== null && !isIdentifier(value.categoryId)) return null;
  return value as unknown as AlertCandidate;
}

export function alertDedupeKey(interestId: string, candidate: AlertCandidate): string {
  return `v1:${encodeURIComponent(candidate.kind)}:${encodeURIComponent(candidate.id)}:${encodeURIComponent(interestId)}`;
}

export function evaluateAlertEligibility(
  rawInterest: unknown,
  rawCandidate: unknown,
  priorNotificationKeys: ReadonlySet<string>,
): AlertEligibility {
  const interest = parseInterest(rawInterest);
  const candidate = parseCandidate(rawCandidate);
  if (!interest || !candidate) return { eligible: false, reason: 'invalid_input' };
  if (!interest.active) return { eligible: false, reason: 'inactive_interest' };
  if (!interest.cityIds.includes(candidate.cityId)) return { eligible: false, reason: 'city_mismatch' };
  if (
    interest.neighborhoodIds.length > 0 &&
    (candidate.neighborhoodId === null || !interest.neighborhoodIds.includes(candidate.neighborhoodId))
  ) {
    return { eligible: false, reason: 'neighborhood_mismatch' };
  }
  if (
    interest.categoryIds.length > 0 &&
    (candidate.categoryId === null || !interest.categoryIds.includes(candidate.categoryId))
  ) {
    return { eligible: false, reason: 'category_mismatch' };
  }
  const dedupeKey = alertDedupeKey(interest.id, candidate);
  if (priorNotificationKeys.has(dedupeKey)) return { eligible: false, reason: 'already_notified' };
  return { eligible: true, dedupeKey };
}
