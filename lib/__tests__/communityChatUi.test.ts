import { formatChatDay, insertMentionAt, isSameChatDay, mentionQueryAt } from '../communityChatUi';

describe('community chat presentation helpers', () => {
  it('finds a partial mention only when the caret is inside it', () => {
    expect(mentionQueryAt('hey @sa', 7)).toBe('sa');
    expect(mentionQueryAt('hey @sa later', 13)).toBeNull();
    expect(mentionQueryAt('email@example.com', 17)).toBeNull();
  });

  it('replaces the partial mention without disturbing text after the caret', () => {
    expect(insertMentionAt('hey @sa tomorrow', 7, 'Sage')).toEqual({
      text: 'hey @Sage tomorrow',
      caret: 10,
    });
  });

  it('groups by Los Angeles calendar day', () => {
    expect(isSameChatDay('2026-08-29T05:30:00Z', '2026-08-29T06:30:00Z')).toBe(true);
    expect(isSameChatDay('2026-08-29T06:30:00Z', '2026-08-29T07:30:00Z')).toBe(false);
  });

  it.each([
    ['2026-03-08T09:59:00Z', '2026-03-08T10:01:00Z', true], // Spring jump.
    ['2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z', true], // Repeated fall hour.
    ['2026-11-02T07:59:59Z', '2026-11-02T08:00:00Z', false], // Winter midnight.
    ['2026-10-07T00:00:00-07:00', '2026-10-07T07:00:00Z', true],
    ['2026-01-01T07:59:59Z', '2026-01-01T08:00:00Z', false],
  ])('keeps LA boundaries for %s and %s', (a, b, same) => {
    expect(isSameChatDay(a, b)).toBe(same);
  });

  it('does not freeze today/yesterday labels when the LA day changes', () => {
    jest.useFakeTimers();
    try {
      const message = '2026-10-07T18:00:00Z';
      jest.setSystemTime(new Date('2026-10-08T06:59:59Z'));
      expect(formatChatDay(message)).toBe('today');
      jest.setSystemTime(new Date('2026-10-08T07:00:00Z'));
      expect(formatChatDay(message)).toBe('yesterday');
    } finally { jest.useRealTimers(); }
  });
});
