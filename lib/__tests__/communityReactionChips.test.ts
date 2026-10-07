import { aggregateReactionChips, reactionKeyForEmoji, topicReactionCounts } from '../communityReactionChips';

describe('community reaction presentation compatibility', () => {
  it('shows every actual emoji without zero-count presets or collapsing skin tones', () => {
    expect(aggregateReactionChips([
      { emoji: '🔥', count: 0, mine: false },
      { emoji: '🪩', count: 3, mine: false },
      { emoji: '👍🏽', count: 1, mine: true },
      { emoji: '👍', count: 2, mine: false },
    ])).toEqual([
      { emoji: '🪩', storageKey: '🪩', count: 3, mine: false },
      { emoji: '👍🏽', storageKey: '👍🏽', count: 1, mine: true },
      { emoji: '👍', storageKey: '👍', count: 2, mine: false },
    ]);
  });

  it.each([
    ['heart', '❤️'],
    ['❤️', 'heart'],
  ])('combines heart counts while retaining the viewer’s %s key', (mineKey, otherKey) => {
    const counts = [
      { emoji: otherKey, count: 2, mine: false },
      { emoji: mineKey, count: 1, mine: true },
    ];
    expect(aggregateReactionChips(counts)).toEqual([{ emoji: '❤️', storageKey: mineKey, count: 3, mine: true }]);
    expect(reactionKeyForEmoji('❤️', counts, 'heart')).toBe(mineKey);
  });

  it('keeps independent selected broadcast reactions instead of imposing a single selection', () => {
    const counts = [{ emoji: '👏', count: 1, mine: true }, { emoji: '🪩', count: 2, mine: true }];
    expect(aggregateReactionChips(counts).filter(chip => chip.mine).map(chip => chip.storageKey)).toEqual(['👏', '🪩']);
    expect(counts).toEqual([{ emoji: '👏', count: 1, mine: true }, { emoji: '🪩', count: 2, mine: true }]);
  });

  it('adapts topic rows without rewriting the underlying stored reactions', () => {
    const rows = [{ user_id: 'other', reaction: '❤️' }, { user_id: 'me', reaction: 'heart' }, { user_id: 'third', reaction: '🪩' }];
    expect(aggregateReactionChips(topicReactionCounts(rows, 'me'))).toEqual([
      { emoji: '❤️', storageKey: 'heart', count: 2, mine: true },
      { emoji: '🪩', storageKey: '🪩', count: 1, mine: false },
    ]);
    expect(topicReactionCounts(rows, null).some(reaction => reaction.mine)).toBe(false);
    expect(rows[1].reaction).toBe('heart');
  });

  it('preserves broadcast and topic defaults only when a matching reaction does not exist', () => {
    expect(reactionKeyForEmoji('❤️', [])).toBe('❤️');
    expect(reactionKeyForEmoji('❤️', [], 'heart')).toBe('heart');
    expect(reactionKeyForEmoji('🪩', [], 'heart')).toBe('🪩');
    expect(reactionKeyForEmoji('❤️', [{ emoji: '❤️', count: 2, mine: false }], 'heart')).toBe('❤️');
  });

  it('omits invalid and empty summaries', () => {
    expect(aggregateReactionChips([
      { emoji: '', count: 1, mine: false },
      { emoji: '🔥', count: -1, mine: false },
      { emoji: '👏', count: Number.NaN, mine: false },
      { emoji: '🪩', count: Number.POSITIVE_INFINITY, mine: false },
    ])).toEqual([]);
  });
});
