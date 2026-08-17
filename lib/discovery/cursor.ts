export const DISCOVERY_KINDS = ['plan', 'event', 'community'] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export interface DiscoveryCandidate<T = unknown> {
  kind: DiscoveryKind;
  id: string;
  score: number;
  sortTime: string;
  payload: T;
}

export interface DiscoveryCursor {
  version: 1;
  kind: DiscoveryKind;
  id: string;
  score: number;
  sortTime: string;
}

export interface DiscoveryPage<T = unknown> {
  items: DiscoveryCandidate<T>[];
  nextCursor: string | null;
}

const KINDS = new Set<string>(DISCOVERY_KINDS);
const CANDIDATE_KEYS = new Set(['kind', 'id', 'score', 'sortTime', 'payload']);
const CURSOR_KEYS = new Set(['version', 'kind', 'id', 'score', 'sortTime']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSortFields(value: Record<string, unknown>): boolean {
  return isIdentifier(value.kind) &&
    KINDS.has(value.kind) &&
    isIdentifier(value.id) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    isIdentifier(value.sortTime) &&
    Number.isFinite(Date.parse(value.sortTime));
}

function parseCandidate<T>(value: unknown): DiscoveryCandidate<T> | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CANDIDATE_KEYS.has(key))) return null;
  if (!parseSortFields(value) || !Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  return value as unknown as DiscoveryCandidate<T>;
}

function parseCursor(value: unknown): DiscoveryCursor | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CURSOR_KEYS.has(key))) return null;
  if (value.version !== 1 || !parseSortFields(value)) return null;
  return value as unknown as DiscoveryCursor;
}

function compareSortFields(
  left: Pick<DiscoveryCandidate, 'score' | 'sortTime' | 'kind' | 'id'>,
  right: Pick<DiscoveryCandidate, 'score' | 'sortTime' | 'kind' | 'id'>,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const timeDifference = Date.parse(right.sortTime) - Date.parse(left.sortTime);
  if (timeDifference !== 0) return timeDifference;
  const kindDifference = left.kind.localeCompare(right.kind);
  if (kindDifference !== 0) return kindDifference;
  return left.id.localeCompare(right.id);
}

export function encodeDiscoveryCursor(candidate: DiscoveryCandidate): string {
  const cursor: DiscoveryCursor = {
    version: 1,
    kind: candidate.kind,
    id: candidate.id,
    score: candidate.score,
    sortTime: candidate.sortTime,
  };
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodeDiscoveryCursor(value: string): DiscoveryCursor | null {
  try {
    return parseCursor(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
}

export function paginateDiscoveryCandidates<T>(
  rawCandidates: readonly unknown[],
  encodedCursor: string | null,
  limit: number,
): DiscoveryPage<T> | null {
  if (!Number.isSafeInteger(limit) || limit <= 0) return null;
  const cursor = encodedCursor === null ? null : decodeDiscoveryCursor(encodedCursor);
  if (encodedCursor !== null && cursor === null) return null;

  const candidates: DiscoveryCandidate<T>[] = [];
  for (const rawCandidate of rawCandidates) {
    const candidate = parseCandidate<T>(rawCandidate);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  candidates.sort(compareSortFields);

  const afterCursor = cursor
    ? candidates.filter((candidate) => compareSortFields(candidate, cursor) > 0)
    : candidates;
  const items = afterCursor.slice(0, limit);
  return {
    items,
    nextCursor: items.length < afterCursor.length
      ? encodeDiscoveryCursor(items[items.length - 1])
      : null,
  };
}
