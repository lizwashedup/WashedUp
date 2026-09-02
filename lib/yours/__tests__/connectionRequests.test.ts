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
});

describe('parseAddOrAcceptOutcome', () => {
  it.each(['requested', 'now_connected', 'already_connected'] as const)(
    'passes a recognized outcome "%s" through unchanged',
    (outcome) => {
      expect(parseAddOrAcceptOutcome(outcome)).toBe(outcome);
    },
  );

  it('falls back to "requested" for an unrecognized value instead of ever silently implying a connection exists', () => {
    expect(parseAddOrAcceptOutcome('some_future_outcome')).toBe('requested');
    expect(parseAddOrAcceptOutcome(null)).toBe('requested');
    expect(parseAddOrAcceptOutcome(undefined)).toBe('requested');
  });
});
