import { insertMentionAt, isSameChatDay, mentionQueryAt } from '../communityChatUi';

describe('community chat presentation helpers', () => {
  it('finds a partial mention only when the caret is inside it', () => {
    expect(mentionQueryAt('hey @sa', 7)).toBe('sa');
    expect(mentionQueryAt('hey @sa later', 13)).toBeNull();
    expect(mentionQueryAt('email@example.com', 17)).toBeNull();
  });

  it('replaces the partial mention without disturbing text after the caret', () => {
    expect(insertMentionAt('hey @sa tomorrow', 7, 'Sage')).toEqual({
      text: 'hey @Sage tomorrow',
      caret: 9,
    });
  });

  it('groups by Los Angeles calendar day', () => {
    expect(isSameChatDay('2026-08-29T05:30:00Z', '2026-08-29T06:30:00Z')).toBe(true);
    expect(isSameChatDay('2026-08-29T06:30:00Z', '2026-08-29T07:30:00Z')).toBe(false);
  });
});
