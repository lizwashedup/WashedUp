import { parseActivitySignal, summarizeActivitySignals } from '../activitySignals';
import { rankActivities } from '../rankActivities';

const NOW = Date.parse('2026-08-16T12:00:00.000Z');

describe('activity-only ranking contracts', () => {
  it('rejects person-targeted and unknown signal shapes', () => {
    expect(
      parseActivitySignal({
        kind: 'viewed',
        activityId: 'a1',
        occurredAt: '2026-08-16T10:00:00.000Z',
        personId: 'p1',
      }),
    ).toBeNull();
  });

  it('ignores invalid, future, and out-of-window signals', () => {
    const summary = summarizeActivitySignals(
      [
        { kind: 'attended', activityId: 'a1', categoryId: 'music', cityId: 'la', occurredAt: '2026-08-16T10:00:00.000Z' },
        { kind: 'viewed', activityId: 'a2', categoryId: 'music', cityId: 'la', occurredAt: '2026-08-17T10:00:00.000Z' },
        { kind: 'saved', activityId: 'a3', categoryId: 'food', cityId: 'la', occurredAt: '2026-07-01T10:00:00.000Z' },
        { kind: 'profile_viewed', activityId: 'a4', occurredAt: '2026-08-16T10:00:00.000Z' },
      ],
      { nowMs: NOW, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
    );

    expect(summary).toEqual({
      acceptedSignalCount: 1,
      activityCounts: { a1: 1 },
      categoryCounts: { music: 1 },
      cityCounts: { la: 1 },
    });
  });

  it('does not turn negative feedback into positive affinity', () => {
    const summary = summarizeActivitySignals(
      [
        { kind: 'feedback_negative', activityId: 'a1', categoryId: 'music', cityId: 'la', occurredAt: '2026-08-16T10:00:00.000Z' },
      ],
      { nowMs: NOW, maxAgeMs: 24 * 60 * 60 * 1000 },
    );
    expect(summary.acceptedSignalCount).toBe(1);
    expect(summary.activityCounts).toEqual({ a1: 1 });
    expect(summary.categoryCounts).toEqual({});
    expect(summary.cityCounts).toEqual({});
  });

  it('uses only caller-supplied weights and deterministic tie breakers', () => {
    const summary = summarizeActivitySignals(
      [{ kind: 'attended', activityId: 'a0', categoryId: 'music', cityId: 'la', occurredAt: '2026-08-16T10:00:00.000Z' }],
      { nowMs: NOW, maxAgeMs: 24 * 60 * 60 * 1000 },
    );
    const result = rankActivities(
      [
        { id: 'b', categoryId: 'food', cityId: 'la', startsAt: '2026-08-20T10:00:00.000Z', payload: {} },
        { id: 'a', categoryId: 'music', cityId: 'other', startsAt: '2026-08-20T10:00:00.000Z', payload: {} },
      ],
      summary,
      { categoryAffinity: 2, cityAffinity: 2 },
    );
    expect(result.map((entry) => entry.activity.id)).toEqual(['a', 'b']);
    expect(result.map((entry) => entry.score)).toEqual([2, 2]);
  });

  it('fails closed when ranking weights are invalid', () => {
    const result = rankActivities(
      [{ id: 'a', categoryId: 'music', cityId: 'la', startsAt: '2026-08-20T10:00:00.000Z', payload: {} }],
      { acceptedSignalCount: 0, activityCounts: {}, categoryCounts: {}, cityCounts: {} },
      { categoryAffinity: Number.NaN, cityAffinity: 1 },
    );
    expect(result).toEqual([]);
  });

  it('fails closed when a supplied signal summary is malformed', () => {
    const result = rankActivities(
      [{ id: 'a', categoryId: 'music', cityId: 'la', startsAt: '2026-08-20T10:00:00.000Z', payload: {} }],
      { acceptedSignalCount: 1, activityCounts: {}, categoryCounts: { music: -1 }, cityCounts: {} },
      { categoryAffinity: 1, cityAffinity: 1 },
    );
    expect(result).toEqual([]);
  });
});
