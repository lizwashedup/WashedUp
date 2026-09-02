import AsyncStorage from '@react-native-async-storage/async-storage';

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: mockRpc } }));

const {
  listQueued,
  normalizeCode,
  queuedCount,
  recordCheckin,
  syncQueuedCheckins,
} = require('../ticketDoor');

const QUEUE_KEY = 'ticket_checkin_queue_v1';

beforeEach(async () => {
  mockRpc.mockReset();
  await AsyncStorage.clear();
});

describe('ticket door offline contract', () => {
  it('normalizes and sends only the seat reference code', async () => {
    mockRpc.mockResolvedValue({ data: 'admitted', error: null });
    await expect(recordCheckin('  seat-code  ')).resolves.toEqual({
      kind: 'result', result: 'admitted', code: 'SEAT-CODE', admittedAt: null,
    });
    expect(normalizeCode(' a-b ')).toBe('A-B');
    expect(mockRpc).toHaveBeenCalledWith('record_ticket_checkin', {
      p_reference_code: 'SEAT-CODE',
    });
  });

  it('reads the grown {result, admitted_at} jsonb shape and threads the timestamp through', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { result: 'duplicate', admitted_at: '2026-09-01T20:47:00-07:00' },
      error: null,
    });
    await expect(recordCheckin('seat-two')).resolves.toEqual({
      kind: 'result', result: 'duplicate', code: 'SEAT-TWO', admittedAt: '2026-09-01T20:47:00-07:00',
    });
  });

  it('still reads a pre-upgrade bare-string reply correctly (rollout-lag fallback)', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'duplicate', error: null });
    await expect(recordCheckin('seat-three')).resolves.toEqual({
      kind: 'result', result: 'duplicate', code: 'SEAT-THREE', admittedAt: null,
    });
  });

  it('never queues real server verdicts or refusals', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'unknown reference' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'organizer required', code: '42501' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'refused', code: '22000' } });
    await expect(recordCheckin('unknown')).resolves.toEqual({ kind: 'unknown', code: 'UNKNOWN' });
    await expect(recordCheckin('wrong-owner')).resolves.toMatchObject({ kind: 'error', code: 'WRONG-OWNER' });
    await expect(recordCheckin('refused')).resolves.toMatchObject({ kind: 'error', code: 'REFUSED' });
    await expect(queuedCount()).resolves.toBe(0);
  });

  it('queues only signal failures and deduplicates normalized codes', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network request failed' } })
      .mockRejectedValueOnce(new Error('socket closed'));
    await expect(recordCheckin(' seat-one ')).resolves.toEqual({ kind: 'queued', code: 'SEAT-ONE' });
    await expect(recordCheckin('seat-one')).resolves.toEqual({ kind: 'queued', code: 'SEAT-ONE' });
    await expect(queuedCount()).resolves.toBe(1);
  });

  it('drains in order and retains only codes that still lack a server answer', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await recordCheckin('first');
    await recordCheckin('second');
    await recordCheckin('third');

    mockRpc
      .mockResolvedValueOnce({ data: 'duplicate', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'unknown reference' } });

    const summary = await syncQueuedCheckins();
    expect(mockRpc.mock.calls.slice(3).map((call) => call[1].p_reference_code)).toEqual([
      'FIRST', 'SECOND', 'THIRD',
    ]);
    expect(summary.processed.map((item: { code: string }) => item.code)).toEqual(['FIRST', 'THIRD']);
    expect(summary.remaining).toBe(1);
    await expect(queuedCount()).resolves.toBe(1);
  });

  it('rejects an empty code before any database call', async () => {
    await expect(recordCheckin('   ')).resolves.toMatchObject({ kind: 'error', code: '' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('signs a queued record and drops it without replay if the signature no longer matches', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await recordCheckin('legit');
    const stored = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(typeof stored[0].signature).toBe('string');
    expect(stored[0].signature.length).toBeGreaterThan(0);

    mockRpc.mockClear();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([
      { code: 'TAMPERED', queuedAt: '2026-08-16T00:00:00Z', signature: 'not-a-real-signature' },
    ]));
    const summary = await syncQueuedCheckins();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(summary.processed).toEqual([
      { code: 'TAMPERED', outcome: { kind: 'error', message: 'that queued check-in did not verify. scan again.', code: 'TAMPERED' } },
    ]);
    expect(summary.remaining).toBe(0);
    await expect(queuedCount()).resolves.toBe(0);
  });

  it('lists queued codes oldest-first without leaking the signature, for the offline door list UI', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await recordCheckin('later');
    await recordCheckin('earlier');
    // force a queuedAt ordering independent of call order, since both queue in the same tick
    const stored = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]');
    stored[0].queuedAt = '2026-09-01T12:00:00Z';
    stored[1].queuedAt = '2026-09-01T09:00:00Z';
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(stored));

    const list = await listQueued();
    expect(list).toEqual([
      { code: 'EARLIER', queuedAt: '2026-09-01T09:00:00Z' },
      { code: 'LATER', queuedAt: '2026-09-01T12:00:00Z' },
    ]);
    expect(list.every((item: Record<string, unknown>) => !('signature' in item))).toBe(true);
  });
});
