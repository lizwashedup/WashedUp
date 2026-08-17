export interface RegionContext {
  countryCode: string;
  currencyCode: string;
  timeZone: string;
  locale: string;
  cityId: string;
  latitude: number;
  longitude: number;
}

const REGION_KEYS = new Set([
  'countryCode',
  'currencyCode',
  'timeZone',
  'locale',
  'cityId',
  'latitude',
  'longitude',
]);
const COUNTRY_CODE = /^[A-Z]{2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimeZone(value: string): boolean {
  if (value !== 'UTC' && !value.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function validLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export function parseRegionContext(value: unknown): RegionContext | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => REGION_KEYS.has(key))) return null;
  if (typeof value.countryCode !== 'string' || !COUNTRY_CODE.test(value.countryCode)) return null;
  if (typeof value.currencyCode !== 'string' || !CURRENCY_CODE.test(value.currencyCode)) return null;
  if (typeof value.timeZone !== 'string' || !validTimeZone(value.timeZone)) return null;
  if (typeof value.locale !== 'string' || !validLocale(value.locale)) return null;
  if (typeof value.cityId !== 'string' || value.cityId.trim().length === 0) return null;
  if (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude)) return null;
  if (typeof value.longitude !== 'number' || !Number.isFinite(value.longitude)) return null;
  if (value.latitude < -90 || value.latitude > 90) return null;
  if (value.longitude < -180 || value.longitude > 180) return null;

  return value as unknown as RegionContext;
}
