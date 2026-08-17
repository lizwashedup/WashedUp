export interface RolloutMatrixEntry {
  cityId: string;
  dimension: string;
  enabled: boolean;
}

const ENTRY_KEYS = new Set(['cityId', 'dimension', 'enabled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseRolloutMatrix(value: unknown): RolloutMatrixEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: RolloutMatrixEntry[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (!isRecord(rawEntry) || !Object.keys(rawEntry).every((key) => ENTRY_KEYS.has(key))) return null;
    if (!isIdentifier(rawEntry.cityId) || !isIdentifier(rawEntry.dimension)) return null;
    if (typeof rawEntry.enabled !== 'boolean') return null;
    const key = `${rawEntry.cityId}\u0000${rawEntry.dimension}`;
    if (seen.has(key)) return null;
    seen.add(key);
    entries.push(rawEntry as unknown as RolloutMatrixEntry);
  }
  return entries;
}

export function isDimensionEnabled(
  rawMatrix: unknown,
  cityId: string,
  dimension: string,
  allowedDimensions: ReadonlySet<string>,
): boolean {
  if (!isIdentifier(cityId) || !isIdentifier(dimension) || !allowedDimensions.has(dimension)) return false;
  const matrix = parseRolloutMatrix(rawMatrix);
  if (!matrix) return false;
  return matrix.some(
    (entry) => entry.cityId === cityId && entry.dimension === dimension && entry.enabled === true,
  );
}
