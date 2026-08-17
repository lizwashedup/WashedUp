import {
  parseActivityDraftSuggestionBatch,
  partitionDraftSuggestions,
} from '../activityDraftContract';

const allowedCategories = new Set(['music', 'food']);
const batch = (context: string, suggestions: unknown[] = []) => ({ context, suggestions });
const suggestion = (overrides: Record<string, unknown> = {}) => ({
  field: 'title',
  value: 'Local show',
  confidence: 0.9,
  evidence: 'Local show',
  ...overrides,
});

describe('activity draft extraction contracts', () => {
  it.each(['plan', 'organization_event', 'community_event'])('accepts the %s posting context', (context) => {
    expect(parseActivityDraftSuggestionBatch(batch(context, [suggestion()]), allowedCategories)).not.toBeNull();
  });

  it('rejects unknown fields and unknown posting contexts', () => {
    expect(
      parseActivityDraftSuggestionBatch(batch('plan', [suggestion({ field: 'audiencePersonId' })]), allowedCategories),
    ).toBeNull();
    expect(parseActivityDraftSuggestionBatch(batch('future_context', [suggestion()]), allowedCategories)).toBeNull();
  });

  it('constrains category suggestions to caller-provided identifiers', () => {
    expect(
      parseActivityDraftSuggestionBatch(
        batch('plan', [suggestion({ field: 'categoryId', value: 'unknown-category' })]),
        allowedCategories,
      ),
    ).toBeNull();
  });

  it('rejects duplicate fields and an end before the start', () => {
    expect(
      parseActivityDraftSuggestionBatch(
        batch('plan', [suggestion(), suggestion({ value: 'Conflicting title' })]),
        allowedCategories,
      ),
    ).toBeNull();
    expect(
      parseActivityDraftSuggestionBatch(
        batch('plan', [
          suggestion({ field: 'startsAt', value: '2026-08-16T12:00:00.000Z' }),
          suggestion({ field: 'endsAt', value: '2026-08-16T11:00:00.000Z' }),
        ]),
        allowedCategories,
      ),
    ).toBeNull();
  });

  it('keeps low-confidence suggestions out of the auto-apply-eligible set', () => {
    const parsed = parseActivityDraftSuggestionBatch(
      batch('plan', [suggestion({ confidence: 0.4 }), suggestion({ field: 'categoryId', value: 'music', confidence: 0.8 })]),
      allowedCategories,
    );
    expect(parsed).not.toBeNull();
    const partitioned = partitionDraftSuggestions(parsed!, 0.75);
    expect(partitioned?.autoApplyEligible.map((item) => item.field)).toEqual(['categoryId']);
    expect(partitioned?.reviewRequired.map((item) => item.field)).toEqual(['title']);
  });

  it('fails closed for an invalid caller-provided confidence threshold', () => {
    const parsed = parseActivityDraftSuggestionBatch(batch('plan', [suggestion()]), allowedCategories)!;
    expect(partitionDraftSuggestions(parsed, Number.NaN)).toBeNull();
  });
});
