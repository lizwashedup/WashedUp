export interface CreatorBrandFields {
  displayName: string;
  logoUrl: string | null;
  accentColor: string;
}

export interface CreatorBrandSnapshot extends CreatorBrandFields {
  source: 'activity' | 'creator_default';
  snapshotVersion: 1;
  snapshotKey: string;
}

const BRAND_KEYS = new Set(['displayName', 'logoUrl', 'accentColor']);
const HEX_COLOR = /^#[0-9A-F]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLogoUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

export function parseCreatorBrand(value: unknown): CreatorBrandFields | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => BRAND_KEYS.has(key))) return null;
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0) return null;
  if (!validLogoUrl(value.logoUrl)) return null;
  if (typeof value.accentColor !== 'string' || !HEX_COLOR.test(value.accentColor)) return null;
  return {
    displayName: value.displayName.trim(),
    logoUrl: value.logoUrl,
    accentColor: value.accentColor.toUpperCase(),
  };
}

function makeSnapshotKey(brand: CreatorBrandFields): string {
  return `v1:${encodeURIComponent(brand.displayName)}:${encodeURIComponent(brand.logoUrl ?? '')}:${brand.accentColor}`;
}

export function resolveCreatorBrand(
  rawActivityBrand: unknown,
  rawCreatorDefaultBrand: unknown,
): CreatorBrandSnapshot | null {
  const creatorDefault = parseCreatorBrand(rawCreatorDefaultBrand);
  if (!creatorDefault) return null;
  const activity = parseCreatorBrand(rawActivityBrand);
  const selected = activity ?? creatorDefault;
  return {
    ...selected,
    source: activity ? 'activity' : 'creator_default',
    snapshotVersion: 1,
    snapshotKey: makeSnapshotKey(selected),
  };
}
