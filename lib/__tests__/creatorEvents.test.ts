jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));

import { supabase } from '../supabase';
import { probeTicketCapacityRpc, setEventTicketCapacity, createOperatorEvent } from '../creatorEvents';
import fs from 'fs';
import path from 'path';

const mockRpc = supabase.rpc as jest.Mock;

it('makes creators approve the same 4:5 crop guests will see', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'creatorEvents.ts'), 'utf8');
  expect(source).toContain('allowsEditing: true');
  expect(source).toContain('aspect: [4, 5]');
});

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


describe('account-owned event creation',()=>{
 const fields:any={title:'Ski evening',start_time:null,end_time:null,pin_to_chat:false};
 let active=true;const scope={userId:'alice',isCurrent:()=>active};
 beforeEach(()=>{jest.clearAllMocks();active=true;jest.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:'alice'},access_token:'fixture-token'}},error:null} as any);});
 it('pins dispatch to the account that initiated the form',async()=>{
  const header=jest.fn().mockResolvedValue({data:'event-id',error:null});mockRpc.mockReturnValue({setHeader:header});
  await expect(createOperatorEvent(fields,'sunset',false,scope)).resolves.toBe('event-id');
  expect(header).toHaveBeenCalledWith('Authorization','Bearer fixture-token');expect(mockRpc).toHaveBeenCalledWith('operator_create_explore_event',expect.objectContaining({p_community_id:'sunset',p_publish:false}));
 });
 it('does not dispatch for another signed-in account',async()=>{
  jest.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:'bob'},access_token:'other-fixture'}},error:null} as any);
  await expect(createOperatorEvent(fields,null,false,scope)).rejects.toThrow('account');expect(mockRpc).not.toHaveBeenCalled();
 });
 it('does not dispatch after the visit ends during session lookup',async()=>{
  jest.mocked(supabase.auth.getSession).mockImplementation(async()=>{active=false;return {data:{session:{user:{id:'alice'},access_token:'fixture-token'}},error:null} as any;});
  await expect(createOperatorEvent(fields,null,false,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();
 });
 it('does not report success or retry a dispatch whose visit has ended',async()=>{
  const header=jest.fn().mockImplementation(async()=>{active=false;return {data:'event-id',error:null};});mockRpc.mockReturnValue({setHeader:header});
  await expect(createOperatorEvent(fields,null,false,scope)).rejects.toThrow('Check the saved event');expect(mockRpc).toHaveBeenCalledTimes(1);
 });
 it('retains the existing unscoped caller contract',async()=>{
  mockRpc.mockResolvedValue({data:'existing',error:null});await expect(createOperatorEvent(fields,null,false)).resolves.toBe('existing');expect(supabase.auth.getSession).not.toHaveBeenCalled();
 });
});
