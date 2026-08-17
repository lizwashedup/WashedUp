export type VisibilityScalar = string | number | boolean;

export type VisibilityRule =
  | { kind: 'public' }
  | { kind: 'deny' }
  | { kind: 'all'; rules: readonly unknown[] }
  | { kind: 'any'; rules: readonly unknown[] }
  | { kind: 'equals'; dimension: string; value: VisibilityScalar }
  | { kind: 'one_of'; dimension: string; values: readonly VisibilityScalar[] }
  | { kind: 'number_range'; dimension: string; minimum?: number; maximum?: number };

export interface VisibilityRolloutEntry {
  cityId: string;
  dimension: string;
  enabled: boolean;
}

export interface VisibilityContext {
  cityId: string;
  viewer: Readonly<Record<string, unknown>>;
  allowedDimensions: readonly string[];
  rollout: readonly VisibilityRolloutEntry[];
}

interface Evaluation {
  valid: boolean;
  visible: boolean;
}

const CONTEXT_KEYS = new Set(['cityId', 'viewer', 'allowedDimensions', 'rollout']);
const ROLLOUT_KEYS = new Set(['cityId', 'dimension', 'enabled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowed.has(key));
}

function isScalar(value: unknown): value is VisibilityScalar {
  return typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseContext(value: unknown): VisibilityContext | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CONTEXT_KEYS.has(key))) return null;
  if (!isIdentifier(value.cityId) || !isRecord(value.viewer)) return null;
  if (!Array.isArray(value.allowedDimensions) || !value.allowedDimensions.every(isIdentifier)) return null;
  if (new Set(value.allowedDimensions).size !== value.allowedDimensions.length) return null;
  if (!Array.isArray(value.rollout)) return null;

  const rollout: VisibilityRolloutEntry[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value.rollout) {
    if (!isRecord(rawEntry) || !Object.keys(rawEntry).every((key) => ROLLOUT_KEYS.has(key))) return null;
    if (!isIdentifier(rawEntry.cityId) || !isIdentifier(rawEntry.dimension)) return null;
    if (typeof rawEntry.enabled !== 'boolean') return null;
    const key = `${rawEntry.cityId}\u0000${rawEntry.dimension}`;
    if (seen.has(key)) return null;
    seen.add(key);
    rollout.push(rawEntry as unknown as VisibilityRolloutEntry);
  }
  return {
    cityId: value.cityId,
    viewer: value.viewer,
    allowedDimensions: value.allowedDimensions,
    rollout,
  };
}

function dimensionEnabled(dimension: string, context: VisibilityContext): boolean {
  if (!context.allowedDimensions.includes(dimension)) return false;
  return context.rollout.some(
    (entry) =>
      entry.cityId === context.cityId &&
      entry.dimension === dimension &&
      entry.enabled === true,
  );
}

function evaluateNode(value: unknown, context: VisibilityContext): Evaluation {
  if (!isRecord(value) || typeof value.kind !== 'string') return { valid: false, visible: false };

  if (value.kind === 'public') {
    return hasExactKeys(value, ['kind'])
      ? { valid: true, visible: true }
      : { valid: false, visible: false };
  }
  if (value.kind === 'deny') {
    return hasExactKeys(value, ['kind'])
      ? { valid: true, visible: false }
      : { valid: false, visible: false };
  }
  if (value.kind === 'all' || value.kind === 'any') {
    if (!hasExactKeys(value, ['kind', 'rules']) || !Array.isArray(value.rules) || value.rules.length === 0) {
      return { valid: false, visible: false };
    }
    const children = value.rules.map((rule) => evaluateNode(rule, context));
    if (children.some((child) => !child.valid)) return { valid: false, visible: false };
    return {
      valid: true,
      visible: value.kind === 'all'
        ? children.every((child) => child.visible)
        : children.some((child) => child.visible),
    };
  }

  if (value.kind === 'equals') {
    if (!hasExactKeys(value, ['kind', 'dimension', 'value'])) return { valid: false, visible: false };
    if (typeof value.dimension !== 'string' || !isScalar(value.value)) return { valid: false, visible: false };
    if (!dimensionEnabled(value.dimension, context)) return { valid: true, visible: false };
    const viewerValue = context.viewer[value.dimension];
    return { valid: true, visible: isScalar(viewerValue) && viewerValue === value.value };
  }

  if (value.kind === 'one_of') {
    if (!hasExactKeys(value, ['kind', 'dimension', 'values'])) return { valid: false, visible: false };
    if (typeof value.dimension !== 'string' || !Array.isArray(value.values) || value.values.length === 0) {
      return { valid: false, visible: false };
    }
    if (!value.values.every(isScalar)) return { valid: false, visible: false };
    if (!dimensionEnabled(value.dimension, context)) return { valid: true, visible: false };
    const viewerValue = context.viewer[value.dimension];
    return { valid: true, visible: isScalar(viewerValue) && value.values.includes(viewerValue) };
  }

  if (value.kind === 'number_range') {
    if (!hasExactKeys(value, ['kind', 'dimension'], ['minimum', 'maximum'])) {
      return { valid: false, visible: false };
    }
    if (typeof value.dimension !== 'string') return { valid: false, visible: false };
    const minimum = value.minimum;
    const maximum = value.maximum;
    if (minimum === undefined && maximum === undefined) return { valid: false, visible: false };
    if (minimum !== undefined && (typeof minimum !== 'number' || !Number.isFinite(minimum))) {
      return { valid: false, visible: false };
    }
    if (maximum !== undefined && (typeof maximum !== 'number' || !Number.isFinite(maximum))) {
      return { valid: false, visible: false };
    }
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      return { valid: false, visible: false };
    }
    if (!dimensionEnabled(value.dimension, context)) return { valid: true, visible: false };
    const viewerValue = context.viewer[value.dimension];
    if (typeof viewerValue !== 'number' || !Number.isFinite(viewerValue)) {
      return { valid: true, visible: false };
    }
    return {
      valid: true,
      visible:
        (minimum === undefined || viewerValue >= minimum) &&
        (maximum === undefined || viewerValue <= maximum),
    };
  }

  return { valid: false, visible: false };
}

export function isVisible(rule: unknown, rawContext: unknown): boolean {
  const context = parseContext(rawContext);
  if (!context) return false;
  const evaluation = evaluateNode(rule, context);
  return evaluation.valid && evaluation.visible;
}
