import AsyncStorage from '@react-native-async-storage/async-storage';

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: mockRpc } }));

const {
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
      kind: 'result', result: 'admitted', code: 'SEAT-CODE',
    });
    expect(normalizeCode(' a-b ')).toBe('A-B');
    expect(mockRpc).toHaveBeenCalledWith('record_ticket_checkin', {
      p_reference_code: 'SEAT-CODE',
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
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([
      { code: 'FIRST', queuedAt: '2026-08-16T00:00:00Z' },
      { code: 'SECOND', queuedAt: '2026-08-16T00:00:01Z' },
      { code: 'THIRD', queuedAt: '2026-08-16T00:00:02Z' },
    ]));
    mockRpc
      .mockResolvedValueOnce({ data: 'duplicate', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'unknown reference' } });

    const summary = await syncQueuedCheckins();
    expect(mockRpc.mock.calls.map((call) => call[1].p_reference_code)).toEqual([
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
});
