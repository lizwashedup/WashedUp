/**
 * circle-mutual-prerequest-race: sendOrAcceptPeopleRequest must always call
 * the atomic add_or_accept_person RPC (THE HANDSHAKE), never the old direct
 * send_people_request insert, which had no reciprocal check at all -- two
 * people requesting each other, same instant or one right after the other,
 * stranded two crossed pending rows that never became a connection.
 */
const mockRpc = jest.fn();
jest.mock('../../supabase', () => ({ supabase: { rpc: mockRpc } }));

const {
  parseAddOrAcceptOutcome,
  sendOrAcceptPeopleRequest,
  UnconfirmedPeopleConnectionError,
} = require('../connectionRequests');

beforeEach(() => mockRpc.mockReset());

describe('sendOrAcceptPeopleRequest', () => {
  it('calls add_or_accept_person with p_target/p_context/p_context_event_id, not send_people_request', async () => {
    mockRpc.mockResolvedValue({ data: 'requested', error: null });

    await sendOrAcceptPeopleRequest({
      recipientId: 'target-1',
      context: 'plan_history',
      contextEventId: 'event-1',
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('add_or_accept_person', {
      p_target: 'target-1',
      p_context: 'plan_history',
      p_context_event_id: 'event-1',
    });
  });

  it('defaults context_event_id to null when the caller omits it (backlog/handle-lookup/keep/profile-card all do)', async () => {
    mockRpc.mockResolvedValue({ data: 'requested', error: null });

    await sendOrAcceptPeopleRequest({
      recipientId: 'target-2',
      context: 'handle_lookup',
    });

    expect(mockRpc).toHaveBeenCalledWith('add_or_accept_person', {
      p_target: 'target-2',
      p_context: 'handle_lookup',
      p_context_event_id: null,
    });
  });

  it('resolves "now_connected" for the mutual-request race: the other side already sent a pending request, so this call accepted it instead of crossing it', async () => {
    mockRpc.mockResolvedValue({ data: 'now_connected', error: null });

    const outcome = await sendOrAcceptPeopleRequest({
      recipientId: 'target-3',
      context: 'plan_history',
    });

    expect(outcome).toBe('now_connected');
  });

  it('resolves "already_connected" as a no-op when a race left the pair already mutual', async () => {
    mockRpc.mockResolvedValue({ data: 'already_connected', error: null });

    const outcome = await sendOrAcceptPeopleRequest({
      recipientId: 'target-4',
      context: 'handle_lookup',
    });

    expect(outcome).toBe('already_connected');
  });

  it('throws on an RPC error (e.g. blocked) instead of swallowing it', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('blocked') });

    await expect(
      sendOrAcceptPeopleRequest({ recipientId: 'target-5', context: 'handle_lookup' }),
    ).rejects.toThrow('blocked');
  });

  it.each([null, undefined, 'some_future_outcome', { outcome: 'requested' }, ['now_connected']])('does not fabricate request confirmation from RPC data %p', async data => {
    mockRpc.mockResolvedValueOnce({ data, error: null });
    await expect(sendOrAcceptPeopleRequest({ recipientId: 'target-5', context: 'handle_lookup' }))
      .rejects.toBeInstanceOf(UnconfirmedPeopleConnectionError);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('preserves a server rejection even if data contains a recognized success string', async () => {
    const error = new Error('cannot_re_request'); mockRpc.mockResolvedValueOnce({ data: 'requested', error });
    await expect(sendOrAcceptPeopleRequest({ recipientId: 'target-5', context: 'handle_lookup' })).rejects.toBe(error);
  });

  it('allows an explicit same-target retry to receive the server’s reconciled outcome', async () => {
    const args = { recipientId: 'target-5', context: 'handle_lookup' };
    mockRpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: 'already_connected', error: null });
    await expect(sendOrAcceptPeopleRequest(args)).rejects.toBeInstanceOf(UnconfirmedPeopleConnectionError);
    await expect(sendOrAcceptPeopleRequest(args)).resolves.toBe('already_connected');
    expect(mockRpc.mock.calls[0]).toEqual(mockRpc.mock.calls[1]);
  });
});

describe('parseAddOrAcceptOutcome', () => {
  it.each(['requested', 'now_connected', 'already_connected'] as const)(
    'passes a recognized outcome "%s" through unchanged',
    (outcome) => {
      expect(parseAddOrAcceptOutcome(outcome)).toBe(outcome);
    },
  );

  it.each([null, undefined, '', ' requested ', 'REQUESTED', 'some_future_outcome', false, 1, { outcome: 'requested' }, ['requested']])('rejects unconfirmed outcome %p instead of inventing Requested', raw => {
    expect(() => parseAddOrAcceptOutcome(raw)).toThrow(UnconfirmedPeopleConnectionError);
    expect(() => parseAddOrAcceptOutcome(raw)).toThrow('We couldn’t confirm your request. Try again.');
  });
});
