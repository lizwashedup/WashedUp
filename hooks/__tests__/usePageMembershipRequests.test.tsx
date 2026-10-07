import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRead = jest.fn(), mockDecide = jest.fn(), mockStored = jest.fn(), mockPrepare = jest.fn(), mockClear = jest.fn();
jest.mock('../../lib/creatorMembershipRequests', () => ({ membershipRequests: { read: (...args: unknown[]) => mockRead(...args), decide: (...args: unknown[]) => mockDecide(...args) }, membershipDecisionStore: { read: (...args: unknown[]) => mockStored(...args), prepare: (...args: unknown[]) => mockPrepare(...args), clear: (...args: unknown[]) => mockClear(...args) } }));
import { usePageMembershipRequests } from '../usePageMembershipRequests';
const page = '17000000-0000-4000-8000-000000000001', member = '17000000-0000-4000-8000-000000000002';
const request = { memberId: member, userId: 'person', status: 'pending', createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', firstName: 'Juniper' };
const inbox = { pageId: page, pageName: 'Sunset walks', requests: [request], nextCursor: null };
const decision = { pageId: page, memberId: member, approve: true, updatedAt: request.updatedAt };
let scope: { userId: string; isCurrent(): boolean }, active: boolean, hook: ReturnType<typeof usePageMembershipRequests>, tree: ReactTestRenderer;
function Probe() { hook = usePageMembershipRequests(page, scope); return null; }
async function mount() { await act(async () => { tree = create(<Probe />); }); }
beforeEach(() => { jest.clearAllMocks(); jest.mocked(require('react-native').AppState.addEventListener).mockReturnValue({ remove: jest.fn() }); active = true; scope = { userId: 'actor', isCurrent: () => active }; mockStored.mockResolvedValue(null); mockRead.mockResolvedValue(inbox); mockPrepare.mockResolvedValue(undefined); mockClear.mockResolvedValue(undefined); mockDecide.mockResolvedValue({ status: 'active', changed: true }); });
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });
it('requires persisted decision before dispatch and removes only its confirmed request', async () => { await mount(); expect(hook.ready).toBe(true); await act(async () => { await hook.decide(decision); }); expect(mockPrepare.mock.invocationCallOrder[0]).toBeLessThan(mockDecide.mock.invocationCallOrder[0]); expect(mockClear).toHaveBeenCalledWith(decision, expect.objectContaining({ userId: scope.userId })); expect(hook.inbox?.requests).toEqual([]); });
it('does not dispatch when saving the recovery marker fails', async () => { mockPrepare.mockRejectedValue(Error('storage')); await mount(); await act(async () => { await hook.decide(decision); }); expect(mockDecide).not.toHaveBeenCalled(); expect(hook.ready).toBe(false); expect(hook.error).toContain('unconfirmed'); });
it('remount checks pending decision without resending, then explicit retry works', async () => { mockStored.mockResolvedValue(decision); await mount(); expect(mockRead).toHaveBeenCalledWith(page, expect.objectContaining({ userId: scope.userId }), { memberId: member }); expect(mockDecide).not.toHaveBeenCalled(); expect(hook.ready).toBe(false); expect(hook.retry).toBe(true); await act(async () => { await hook.decide(decision); }); expect(mockDecide).toHaveBeenCalledTimes(1); });
it('changed answers retire stale pending decision and require another review', async () => { mockStored.mockResolvedValue(decision); mockRead.mockResolvedValue({ ...inbox, requests: [{ ...request, updatedAt: '2026-09-17T01:00:00Z' }] }); await mount(); expect(mockClear).toHaveBeenCalled(); expect(mockDecide).not.toHaveBeenCalled(); expect(hook.message).toContain('changed'); await act(async () => { await hook.decide(decision); }); expect(mockDecide).not.toHaveBeenCalled(); });
it('a lost response is resolved read-only without repeating approval', async () => { mockDecide.mockRejectedValue(Error('timeout')); await mount(); await act(async () => { await hook.decide(decision); }); expect(hook.ready).toBe(false); mockStored.mockResolvedValue(decision); mockRead.mockImplementation(async (_page, _scope, query) => query?.memberId ? { ...inbox, requests: [{ ...request, status: 'active' }] } : { ...inbox, requests: [] }); await act(async () => { await hook.load(); }); expect(mockDecide).toHaveBeenCalledTimes(1); expect(hook.message).toContain('now a member'); expect(hook.pending).toBeUndefined(); });
it('a retired account cannot publish its response into the new visit', async () => { let finish!: (v: unknown) => void; mockDecide.mockReturnValue(new Promise(r => { finish = r; })); await mount(); let pending!: Promise<void>; await act(async () => { pending = hook.decide(decision); }); active = false; await act(async () => { finish({ status: 'active', changed: true }); await pending; }); expect(hook.message).toBeUndefined(); });
it('rapid duplicate confirmations dispatch once', async () => { await mount(); await act(async () => { await Promise.all([hook.decide(decision), hook.decide(decision)]); }); expect(mockDecide).toHaveBeenCalledTimes(1); });

it('a saved decision beyond the first page remains reachable for explicit retry', async () => { mockStored.mockResolvedValue(decision); mockRead.mockImplementation(async (_p, _s, query) => query?.memberId ? inbox : { ...inbox, requests: [], nextCursor: 'later' }); await mount(); expect(hook.inbox?.requests[0].memberId).toBe(member); await act(async () => { await hook.decide(decision); }); expect(mockDecide).toHaveBeenCalledTimes(1); });


it('releases a stalled first read and ignores its late inbox after explicit recovery', async () => {
  jest.useFakeTimers(); let finish!: (value: unknown) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); expect(hook.busy).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
  expect(hook.busy).toBe(false); expect(hook.error).toContain('check requests');
  await act(async () => { await hook.load(); }); expect(hook.ready).toBe(true);
  await act(async () => { finish({ ...inbox, pageName: 'Stale page' }); });
  expect(hook.inbox?.pageName).toBe('Sunset walks');
});

it('does not dispatch after a stalled recovery-marker write finishes late', async () => {
  jest.useFakeTimers(); let finish!: () => void;
  mockPrepare.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount(); let pending!: Promise<void>;
  await act(async () => { pending = hook.decide(decision); });
  await act(async () => { await jest.advanceTimersByTimeAsync(25_000); await pending; });
  expect(hook.busy).toBe(false); expect(hook.pending).toEqual(decision); expect(hook.retry).toBe(false);
  await act(async () => { finish(); }); expect(mockDecide).not.toHaveBeenCalled();
});
it('recovers a timed-out approval read-only and ignores its late receipt', async () => {
  jest.useFakeTimers(); let finish!: (value: unknown) => void;
  mockDecide.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); let pending!: Promise<void>;
  await act(async () => { pending = hook.decide(decision); });
  await act(async () => { await jest.advanceTimersByTimeAsync(25_000); await pending; });
  expect(hook.error).toContain('unconfirmed'); expect(hook.pending).toEqual(decision);
  mockStored.mockResolvedValue(decision);
  mockRead.mockImplementation(async (_p, _s, query) => query?.memberId ? { ...inbox, requests: [{ ...request, status: 'active' }] } : { ...inbox, requests: [] });
  await act(async () => { await hook.load(); }); expect(hook.message).toContain('now a member');
  await act(async () => { finish({status:'active',changed:true}); });
  expect(mockDecide).toHaveBeenCalledTimes(1); expect(mockClear).toHaveBeenCalledTimes(1); expect(hook.pending).toBeUndefined();
});
it('preserves a confirmed approval when local cleanup stalls', async () => {
  jest.useFakeTimers(); mockClear.mockImplementationOnce(() => new Promise(() => {}));
  await mount(); let pending!: Promise<void>;
  await act(async () => { pending = hook.decide(decision); });
  expect(hook.message).toContain('now a member'); expect(hook.inbox?.requests).toEqual([]);
  await act(async () => { await jest.advanceTimersByTimeAsync(25_000); await pending; });
  expect(hook.error).toContain('decision is saved'); expect(hook.busy).toBe(false); expect(hook.retry).toBe(false);
});
it('status recovery timeout retains the original decision and cannot enable a resend', async () => {
  jest.useFakeTimers(); mockStored.mockResolvedValue(decision); mockRead.mockImplementationOnce(() => new Promise(() => {}));
  await mount(); await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
  expect(hook.pending).toEqual(decision); expect(hook.retry).toBe(false); expect(hook.busy).toBe(false);
  await act(async () => { await hook.decide(decision); }); expect(mockDecide).not.toHaveBeenCalled();
});
it('releases stalled pagination without losing the loaded inbox', async () => {
  jest.useFakeTimers(); mockRead.mockResolvedValueOnce({...inbox,nextCursor:'next'});
  await mount(); mockRead.mockImplementationOnce(() => new Promise(() => {})); let pending!: Promise<void>;
  await act(async () => { pending = hook.more(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(12_000); await pending; });
  expect(hook.busy).toBe(false); expect(hook.inbox?.requests).toEqual([request]); expect(hook.error).toContain('more requests');
});
it('unmounting while persistence waits prevents a later approval', async () => {
  let finish!: () => void; mockPrepare.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount(); let pending!: Promise<void>; await act(async () => { pending = hook.decide(decision); });
  act(() => tree.unmount()); await act(async () => { finish(); await pending; }); expect(mockDecide).not.toHaveBeenCalled();
});
it('background return reads status and retires the interrupted approval preflight', async () => {
  const { AppState } = require('react-native'); let listener!: (value: string) => void;
  const subscription=jest.spyOn(AppState,'addEventListener').mockImplementation((_name:any,callback:any)=>{listener=callback;return{remove:()=>{}};});
  let finish!: () => void; mockPrepare.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  try {
    await mount(); let pending!: Promise<void>; await act(async () => { pending = hook.decide(decision); });
    act(() => listener('background'));expect(hook.busy).toBe(false);
    await act(async () => { listener('active'); });expect(hook.ready).toBe(true);
    await act(async () => { finish(); await pending; });expect(mockDecide).not.toHaveBeenCalled();
  } finally { subscription.mockRestore(); }
});


it('declines only the chosen request and preserves other pending people on the same page',async()=>{
 const other={...request,memberId:'another-member',firstName:'Aster'};
 mockRead.mockResolvedValue({...inbox,requests:[request,other]});mockDecide.mockResolvedValue({status:'declined',changed:true});
 await mount();const decline={...decision,approve:false};await act(async()=>{await hook.decide(decline);});
 expect(mockDecide).toHaveBeenCalledWith(decline,expect.objectContaining({userId:scope.userId}));
 expect(hook.inbox?.pageId).toBe(page);expect(hook.inbox?.requests).toEqual([other]);expect(hook.message).toContain('now declined');
});
it('permission loss during decision recovery keeps private requests unavailable and cannot resend',async()=>{
 await mount();mockDecide.mockRejectedValue(Error('Page access changed'));await act(async()=>{await hook.decide(decision);});
 mockStored.mockResolvedValue(decision);mockRead.mockRejectedValue(Error('Page requests unavailable'));await act(async()=>{await hook.load();});
 expect(hook.error).toContain('access may have changed');expect(hook.ready).toBe(false);expect(hook.retry).toBe(false);expect(hook.pending).toEqual(decision);
 await act(async()=>{await hook.decide(decision);});expect(mockDecide).toHaveBeenCalledTimes(1);
});

it.each([true,false])('clears only completed decision feedback before the next review, approval=%s',async approve=>{
 const other={...request,memberId:'another-member',firstName:'Cedar'};mockRead.mockResolvedValue({...inbox,requests:[request,other]});
 await mount();await act(async()=>{await hook.decide({...decision,approve});});expect(hook.message).toBeTruthy();
 act(()=>hook.clearMessage());expect(hook.message).toBeUndefined();expect(hook.inbox?.requests).toEqual([other]);expect(hook.ready).toBe(true);expect(mockDecide).toHaveBeenCalledTimes(1);
});
it('clears recovered completed feedback but retains an unresolved decision recovery explanation',async()=>{
 mockStored.mockResolvedValue(decision);await mount();expect(hook.retry).toBe(true);const explanation=hook.message;
 act(()=>hook.clearMessage());expect(hook.message).toBe(explanation);expect(hook.pending).toEqual(decision);
 mockRead.mockImplementation(async(_p,_s,query)=>query?.memberId?{...inbox,requests:[{...request,status:'active'}]}:{...inbox,requests:[]});
 await act(async()=>{await hook.load();});expect(hook.message).toContain('now a member');act(()=>hook.clearMessage());expect(hook.message).toBeUndefined();expect(mockDecide).not.toHaveBeenCalled();
});
