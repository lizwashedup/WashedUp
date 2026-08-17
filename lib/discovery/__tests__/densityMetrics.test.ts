import { aggregateDensity, meetsDensityFloor } from '../densityMetrics';

describe('density metrics contracts', () => {
  it('aggregates anonymous counts by city and dimension', () => {
    expect(
      aggregateDensity([
        { cityId: 'la', dimension: 'age', eligibleAudienceCount: 10, impressionCount: 8, conversionCount: 2 },
        { cityId: 'la', dimension: 'age', eligibleAudienceCount: 5, impressionCount: 2, conversionCount: 1 },
      ]),
    ).toEqual([
      {
        cityId: 'la',
        dimension: 'age',
        eligibleAudienceCount: 15,
        impressionCount: 10,
        conversionCount: 3,
        conversionRate: 0.3,
      },
    ]);
  });

  it('rejects row-level identifiers and inconsistent counts', () => {
    expect(
      aggregateDensity([
        { cityId: 'la', dimension: 'age', eligibleAudienceCount: 1, impressionCount: 1, conversionCount: 1, userId: 'u1' },
      ]),
    ).toBeNull();
    expect(
      aggregateDensity([
        { cityId: 'la', dimension: 'age', eligibleAudienceCount: 1, impressionCount: 1, conversionCount: 2 },
      ]),
    ).toBeNull();
  });

  it('evaluates only caller-supplied floors and never enables a rollout', () => {
    const summary = aggregateDensity([
      { cityId: 'la', dimension: 'age', eligibleAudienceCount: 20, impressionCount: 10, conversionCount: 2 },
    ])![0];
    expect(
      meetsDensityFloor(summary, {
        minimumEligibleAudience: 20,
        minimumImpressions: 10,
        minimumConversionRate: 0.2,
      }),
    ).toBe(true);
    expect(
      meetsDensityFloor(summary, {
        minimumEligibleAudience: 21,
        minimumImpressions: 10,
        minimumConversionRate: 0.2,
      }),
    ).toBe(false);
  });

  it('fails closed for a fabricated invalid summary', () => {
    expect(
      meetsDensityFloor(
        {
          cityId: 'la',
          dimension: 'age',
          eligibleAudienceCount: 20,
          impressionCount: 10,
          conversionCount: 2,
          conversionRate: Number.NaN,
        },
        { minimumEligibleAudience: 1, minimumImpressions: 1, minimumConversionRate: 0 },
      ),
    ).toBe(false);
    expect(
      meetsDensityFloor(
        {
          cityId: 'la',
          dimension: 'age',
          eligibleAudienceCount: 20,
          impressionCount: 10,
          conversionCount: 2,
          conversionRate: 0.9,
        },
        { minimumEligibleAudience: 1, minimumImpressions: 1, minimumConversionRate: 0 },
      ),
    ).toBe(false);
  });
});
