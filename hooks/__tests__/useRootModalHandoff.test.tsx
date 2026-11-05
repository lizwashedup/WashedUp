import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useRootModalHandoff } from '../useRootModalHandoff';
const mockReview = jest.fn();
jest.mock('../../lib/reviewAsk', () => ({ maybeRequestReviewAfterTopRating: (...args: unknown[]) => mockReview(...args) }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
let identity: object, allowed: boolean, current: ReturnType<typeof useRootModalHandoff>, tree: ReactTestRenderer;
function Harness() { current = useRootModalHandoff(identity, () => allowed); return null; }
async function tick(ms=0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
beforeEach(()=>{jest.useFakeTimers();identity={};allowed=true;mockReview.mockReset().mockResolvedValue(undefined);act(()=>{tree=create(<Harness/>);});});
afterEach(()=>{act(()=>tree.unmount());jest.clearAllTimers();jest.useRealTimers();});
it('an old review completion cannot clear the new account’s pending review',async()=>{
  const a=deferred(),b=deferred();mockReview.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  act(()=>current.requestReview());await tick(460);const oldGuard=mockReview.mock.calls[0][0];
  act(()=>{identity={};tree.update(<Harness/>);});expect(oldGuard()).toBe(false);
  act(()=>current.requestReview());await tick(460);expect(current.reviewSheetPending).toBe(true);
  a.resolve();await tick();expect(current.reviewSheetPending).toBe(true);
  b.resolve();await tick();expect(current.reviewSheetPending).toBe(false);
});
it('retained callbacks cannot affect a different account’s sequence',async()=>{
  const old=current;act(()=>{identity={};tree.update(<Harness/>);});const close=jest.fn();
  act(()=>{old.handoffModal(close);old.requestReview();});await tick(1000);
  expect(close).not.toHaveBeenCalled();expect(mockReview).not.toHaveBeenCalled();expect(current.modalLocked).toBe(false);
});
it('reset retires an already dispatched review guard and permits a new sequence',async()=>{
  const pending=deferred();mockReview.mockReturnValueOnce(pending.promise);act(()=>current.requestReview());await tick(460);
  const guard=mockReview.mock.calls[0][0];act(()=>current.reset());expect(guard()).toBe(false);expect(current.reviewSheetPending).toBe(false);
  act(()=>current.handoffModal(()=>{}));await tick(400);expect(current.modalLocked).toBe(false);pending.resolve();await tick();
});
