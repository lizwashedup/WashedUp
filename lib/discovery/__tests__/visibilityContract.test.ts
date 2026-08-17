import { isVisible, type VisibilityContext } from '../visibilityContract';

const context = (overrides: Partial<VisibilityContext> = {}): VisibilityContext => ({
  cityId: 'la',
  viewer: { age: 31, audience: 'member' },
  allowedDimensions: ['age', 'audience'],
  rollout: [
    { cityId: 'la', dimension: 'age', enabled: true },
    { cityId: 'la', dimension: 'audience', enabled: true },
  ],
  ...overrides,
});

describe('visibility contract', () => {
  it('allows only an explicit valid public rule without viewer data', () => {
    expect(isVisible({ kind: 'public' }, context({ viewer: {} }))).toBe(true);
    expect(isVisible({ kind: 'public', unexpected: true }, context())).toBe(false);
  });

  it('fails closed for a missing viewer attribute', () => {
    expect(isVisible({ kind: 'equals', dimension: 'audience', value: 'member' }, context({ viewer: {} }))).toBe(false);
  });

  it('fails closed for a disabled or unknown dimension', () => {
    expect(
      isVisible(
        { kind: 'equals', dimension: 'age', value: 31 },
        context({ rollout: [{ cityId: 'la', dimension: 'age', enabled: false }] }),
      ),
    ).toBe(false);
    expect(isVisible({ kind: 'equals', dimension: 'unknown', value: true }, context())).toBe(false);
  });

  it('invalidates the whole tree when any child rule is unknown', () => {
    expect(
      isVisible(
        {
          kind: 'any',
          rules: [
            { kind: 'equals', dimension: 'audience', value: 'member' },
            { kind: 'future_operator', dimension: 'age', value: 31 },
          ],
        },
        context(),
      ),
    ).toBe(false);
  });

  it('evaluates valid composite rules', () => {
    expect(
      isVisible(
        {
          kind: 'all',
          rules: [
            { kind: 'one_of', dimension: 'audience', values: ['member', 'creator'] },
            { kind: 'number_range', dimension: 'age', minimum: 25, maximum: 40 },
          ],
        },
        context(),
      ),
    ).toBe(true);
  });

  it('fails closed for malformed or ambiguous rollout context', () => {
    expect(isVisible({ kind: 'public' }, { ...context(), rollout: null })).toBe(false);
    expect(
      isVisible(
        { kind: 'equals', dimension: 'age', value: 31 },
        {
          ...context(),
          rollout: [
            { cityId: 'la', dimension: 'age', enabled: true },
            { cityId: 'la', dimension: 'age', enabled: false },
          ],
        },
      ),
    ).toBe(false);
  });
});
