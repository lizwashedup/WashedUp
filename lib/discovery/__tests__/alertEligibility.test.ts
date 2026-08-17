import { alertDedupeKey, evaluateAlertEligibility } from '../alertEligibility';

const interest = (overrides: Record<string, unknown> = {}) => ({
  id: 'w1',
  active: true,
  cityIds: ['la'],
  neighborhoodIds: ['silver-lake'],
  categoryIds: ['music'],
  ...overrides,
});
const candidate = (overrides: Record<string, unknown> = {}) => ({
  kind: 'activity',
  id: 'a1',
  cityId: 'la',
  neighborhoodId: 'silver-lake',
  categoryId: 'music',
  ...overrides,
});

describe('alert eligibility contracts', () => {
  it('accepts an activity that matches an active area interest', () => {
    expect(evaluateAlertEligibility(interest(), candidate(), new Set())).toEqual({
      eligible: true,
      dedupeKey: 'v1:activity:a1:w1',
    });
  });

  it('supports a new-community candidate without sending anything', () => {
    expect(
      evaluateAlertEligibility(
        interest({ neighborhoodIds: [], categoryIds: [] }),
        candidate({ kind: 'community', id: 'c1', neighborhoodId: null, categoryId: null }),
        new Set(),
      ),
    ).toEqual({ eligible: true, dedupeKey: 'v1:community:c1:w1' });
  });

  it('fails closed when location data required by the interest is missing', () => {
    expect(evaluateAlertEligibility(interest(), candidate({ neighborhoodId: null }), new Set())).toEqual({
      eligible: false,
      reason: 'neighborhood_mismatch',
    });
  });

  it('rejects inactive, city-mismatched, and category-mismatched inputs', () => {
    expect(evaluateAlertEligibility(interest({ active: false }), candidate(), new Set())).toEqual({
      eligible: false,
      reason: 'inactive_interest',
    });
    expect(evaluateAlertEligibility(interest(), candidate({ cityId: 'nyc' }), new Set())).toEqual({
      eligible: false,
      reason: 'city_mismatch',
    });
    expect(evaluateAlertEligibility(interest(), candidate({ categoryId: 'food' }), new Set())).toEqual({
      eligible: false,
      reason: 'category_mismatch',
    });
  });

  it('deduplicates with an explicit prior-notification key', () => {
    const parsedCandidate = candidate() as Parameters<typeof alertDedupeKey>[1];
    const key = alertDedupeKey('w1', parsedCandidate);
    expect(evaluateAlertEligibility(interest(), candidate(), new Set([key]))).toEqual({
      eligible: false,
      reason: 'already_notified',
    });
  });

  it('keeps separator characters collision-safe in dedupe keys', () => {
    const first = alertDedupeKey('w:1', candidate({ id: 'a1' }) as Parameters<typeof alertDedupeKey>[1]);
    const second = alertDedupeKey('w', candidate({ id: '1:a1' }) as Parameters<typeof alertDedupeKey>[1]);
    expect(first).not.toBe(second);
  });
});
