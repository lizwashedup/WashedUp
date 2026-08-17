export interface ShortlistCandidate<T = unknown> {
  personId: string;
  sharedActivityCount: number;
  matchingCategoryActivityCount: number;
  activityRecency: number;
  payload: T;
}

export interface ShortlistWeights {
  sharedActivityCount: number;
  matchingCategoryActivityCount: number;
  activityRecency: number;
}

export interface RankedShortlistCandidate<T = unknown> {
  candidate: ShortlistCandidate<T>;
  score: number;
}

export interface ShortlistAccessLists {
  allowedPersonIds: ReadonlySet<string>;
  blockedPersonIds: ReadonlySet<string>;
  dismissedPersonIds: ReadonlySet<string>;
  alreadyInvitedPersonIds: ReadonlySet<string>;
}

const CANDIDATE_KEYS = new Set([
  'personId',
  'sharedActivityCount',
  'matchingCategoryActivityCount',
  'activityRecency',
  'payload',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCandidate<T>(value: unknown): ShortlistCandidate<T> | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CANDIDATE_KEYS.has(key))) return null;
  if (typeof value.personId !== 'string' || value.personId.trim().length === 0) return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  if (
    typeof value.sharedActivityCount !== 'number' ||
    !Number.isSafeInteger(value.sharedActivityCount) ||
    value.sharedActivityCount < 0 ||
    typeof value.matchingCategoryActivityCount !== 'number' ||
    !Number.isSafeInteger(value.matchingCategoryActivityCount) ||
    value.matchingCategoryActivityCount < 0 ||
    typeof value.activityRecency !== 'number' ||
    !Number.isFinite(value.activityRecency) ||
    value.activityRecency < 0 ||
    value.activityRecency > 1
  ) {
    return null;
  }
  return value as unknown as ShortlistCandidate<T>;
}

function validWeights(weights: ShortlistWeights): boolean {
  const keys = Object.keys(weights);
  if (
    keys.length !== 3 ||
    !keys.every((key) =>
      key === 'sharedActivityCount' || key === 'matchingCategoryActivityCount' || key === 'activityRecency'
    )
  ) {
    return false;
  }
  return Object.values(weights).every((weight) => Number.isFinite(weight) && weight >= 0);
}

export function buildSmartShortlist<T>(
  rawCandidates: readonly unknown[],
  lists: ShortlistAccessLists,
  weights: ShortlistWeights,
): RankedShortlistCandidate<T>[] {
  if (!validWeights(weights)) return [];

  const unique = new Map<string, ShortlistCandidate<T>>();
  for (const rawCandidate of rawCandidates) {
    const candidate = parseCandidate<T>(rawCandidate);
    if (!candidate) continue;

    // Authorization filtering happens before any score is calculated.
    if (!lists.allowedPersonIds.has(candidate.personId)) continue;
    if (lists.blockedPersonIds.has(candidate.personId)) continue;
    if (lists.dismissedPersonIds.has(candidate.personId)) continue;
    if (lists.alreadyInvitedPersonIds.has(candidate.personId)) continue;
    if (unique.has(candidate.personId)) return [];
    unique.set(candidate.personId, candidate);
  }

  return [...unique.values()]
    .map((candidate) => ({
      candidate,
      score:
        candidate.sharedActivityCount * weights.sharedActivityCount +
        candidate.matchingCategoryActivityCount * weights.matchingCategoryActivityCount +
        candidate.activityRecency * weights.activityRecency,
    }))
    .sort((left, right) =>
      right.score === left.score
        ? left.candidate.personId.localeCompare(right.candidate.personId)
        : right.score - left.score,
    );
}
