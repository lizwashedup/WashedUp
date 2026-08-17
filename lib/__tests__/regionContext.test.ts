import { parseRegionContext } from '../regionContext';

const losAngelesFixture = {
  countryCode: 'US',
  currencyCode: 'USD',
  timeZone: 'America/Los_Angeles',
  locale: 'en-US',
  cityId: 'los-angeles',
  latitude: 34.0522,
  longitude: -118.2437,
};

describe('region context contract', () => {
  it('round-trips the existing LA and US values when supplied as a fixture', () => {
    expect(parseRegionContext(losAngelesFixture)).toEqual(losAngelesFixture);
  });

  it('accepts a non-US context without changing any product default', () => {
    const london = {
      countryCode: 'GB',
      currencyCode: 'GBP',
      timeZone: 'Europe/London',
      locale: 'en-GB',
      cityId: 'london',
      latitude: 51.5072,
      longitude: -0.1276,
    };
    expect(parseRegionContext(london)).toEqual(london);
  });

  it('fails closed for invalid codes, coordinates, time zones, and extra fields', () => {
    expect(parseRegionContext({ ...losAngelesFixture, countryCode: 'usa' })).toBeNull();
    expect(parseRegionContext({ ...losAngelesFixture, latitude: 91 })).toBeNull();
    expect(parseRegionContext({ ...losAngelesFixture, timeZone: 'local' })).toBeNull();
    expect(parseRegionContext({ ...losAngelesFixture, fallbackCountry: 'US' })).toBeNull();
  });
});
