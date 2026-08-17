export const ACTIVITY_SIGNAL_KINDS = [
  'viewed',
  'saved',
  'joined',
  'attended',
  'feedback_positive',
  'feedback_negative',
] as const;

export type ActivitySignalKind = (typeof ACTIVITY_SIGNAL_KINDS)[number];

export interface ActivitySignal {
  kind: ActivitySignalKind;
  activityId: string;
  occurredAt: string;
  categoryId?: string;
  cityId?: string;
}

export interface ActivitySignalWindow {
  nowMs: number;
  maxAgeMs: number;
}

export interface ActivitySignalSummary {
  acceptedSignalCount: number;
  activityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  cityCounts: Record<string, number>;
}

const SIGNAL_KEYS = new Set(['kind', 'activityId', 'occurredAt', 'categoryId', 'cityId']);
const SIGNAL_KINDS = new Set<string>(ACTIVITY_SIGNAL_KINDS);
const AFFINITY_SIGNAL_KINDS = new Set<ActivitySignalKind>([
  'viewed',
  'saved',
  'joined',
  'attended',
  'feedback_positive',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseActivitySignal(value: unknown): ActivitySignal | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SIGNAL_KEYS)) return null;
  if (!isIdentifier(value.kind) || !SIGNAL_KINDS.has(value.kind)) return null;
  if (!isIdentifier(value.activityId) || !isIdentifier(value.occurredAt)) return null;
  if (value.categoryId !== undefined && !isIdentifier(value.categoryId)) return null;
  if (value.cityId !== undefined && !isIdentifier(value.cityId)) return null;
  if (!Number.isFinite(Date.parse(value.occurredAt))) return null;

  return {
    kind: value.kind as ActivitySignalKind,
    activityId: value.activityId,
    occurredAt: value.occurredAt,
    ...(value.categoryId === undefined ? {} : { categoryId: value.categoryId }),
    ...(value.cityId === undefined ? {} : { cityId: value.cityId }),
  };
}

function increment(target: Record<string, number>, key: string | undefined): void {
  if (key) target[key] = (target[key] ?? 0) + 1;
}

export function summarizeActivitySignals(
  values: readonly unknown[],
  window: ActivitySignalWindow,
): ActivitySignalSummary {
  const empty: ActivitySignalSummary = {
    acceptedSignalCount: 0,
    activityCounts: {},
    categoryCounts: {},
    cityCounts: {},
  };

  if (!Number.isFinite(window.nowMs) || !Number.isFinite(window.maxAgeMs) || window.maxAgeMs < 0) {
    return empty;
  }

  for (const value of values) {
    const signal = parseActivitySignal(value);
    if (!signal) continue;
    const occurredAtMs = Date.parse(signal.occurredAt);
    const ageMs = window.nowMs - occurredAtMs;
    if (ageMs < 0 || ageMs > window.maxAgeMs) continue;

    empty.acceptedSignalCount += 1;
    increment(empty.activityCounts, signal.activityId);
    // Negative feedback is valid activity history, but it must never increase
    // category or city affinity without an explicit caller-owned policy.
    if (AFFINITY_SIGNAL_KINDS.has(signal.kind)) {
      increment(empty.categoryCounts, signal.categoryId);
      increment(empty.cityCounts, signal.cityId);
    }
  }

  return empty;
}
