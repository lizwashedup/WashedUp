jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from '../supabase';
import { probeTicketCapacityRpc, setEventTicketCapacity } from '../creatorEvents';

const mockRpc = supabase.rpc as jest.Mock;

// ─── C-21: probeTicketCapacityRpc / setEventTicketCapacity ────────────────
// Regression coverage for the exact bug class eventRsvp.ts hit on
// 2026-08-19: a client that calls a not-yet-applied RPC unconditionally.
// The capacity column is already live, so a naive column-read probe would
// always report "open" here -- these tests pin the RPC-existence check
// (by error code) instead, which is the actual safety property.

describe('probeTicketCapacityRpc', () => {
  beforeEach(() => mockRpc.mockReset());

  it('reads PGRST202 (function not found) as door-closed', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(probeTicketCapacityRpc()).resolves.toBe(false);
  });

  it('reads any other error as door-open (the RPC exists, this call just failed for another reason)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(probeTicketCapacityRpc()).resolves.toBe(true);
  });

  it('probes with a sentinel event id, never a real one', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await probeTicketCapacityRpc();
    expect(mockRpc).toHaveBeenCalledWith('operator_set_event_ticket_capacity', {
      p_event_id: '00000000-0000-0000-0000-000000000000',
      p_ticket_capacity: null,
    });
  });
});

describe('setEventTicketCapacity', () => {
  beforeEach(() => mockRpc.mockReset());

  it('sends the real event id and capacity', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await setEventTicketCapacity('event-1', 25);
    expect(mockRpc).toHaveBeenCalledWith('operator_set_event_ticket_capacity', {
      p_event_id: 'event-1',
      p_ticket_capacity: 25,
    });
  });

  it('sends null to clear the cap', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await setEventTicketCapacity('event-1', null);
    expect(mockRpc).toHaveBeenCalledWith('operator_set_event_ticket_capacity', {
      p_event_id: 'event-1',
      p_ticket_capacity: null,
    });
  });

  it('throws on failure so the caller can swallow it (mirrors setOperatorEventCoords)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(setEventTicketCapacity('event-1', 10)).rejects.toThrow('boom');
  });
});
