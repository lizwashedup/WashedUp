import { restoreChatDraft } from '../restoreChatDraft';

describe('failed chat send recovery', () => {
  it('restores the attempted message when the composer is still empty', () => {
    expect(restoreChatDraft('Meet by the entrance', '')).toBe('Meet by the entrance');
  });

  it('preserves text entered while the failed message was pending', () => {
    expect(restoreChatDraft('Meet by the entrance', 'I have a blue jacket'))
      .toBe('Meet by the entrance\nI have a blue jacket');
  });
});
