import { resolveChatSendReceipt } from '../chatSendReceipt';

const receipt = { id: 'same-client-uuid', created_at: '2026-09-12T20:00:00Z' };

describe('topic send confirmation', () => {
  it('accepts a normal insert receipt without a second network request', async () => {
    const lookup = jest.fn();
    const result = await resolveChatSendReceipt(
      async () => ({ data: receipt, error: null }), lookup,
    );
    expect(result.receipt).toEqual(receipt);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('recovers when the server inserted the message but the response was lost', async () => {
    const result = await resolveChatSendReceipt(
      async () => { throw new Error('network timeout'); },
      async () => ({ data: receipt, error: null }),
    );
    expect(result).toEqual({ receipt, failure: null });
  });

  it('does not claim delivery when both insert and receipt lookup fail', async () => {
    const result = await resolveChatSendReceipt(
      async () => ({ data: null, error: new Error('insert failed') }),
      async () => ({ data: null, error: new Error('lookup failed') }),
    );
    expect(result.receipt).toBeNull();
    expect(result.failure).toBeInstanceOf(Error);
  });
});
