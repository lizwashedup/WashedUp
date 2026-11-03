import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockSearch = jest.fn();
jest.mock('../../lib/coCreatorInvites', () => ({ searchProfilesForInvite: (...args: any[]) => mockSearch(...args) }));
import { useMemberInviteSearch } from '../useMemberInviteSearch';
let tree: ReactTestRenderer, result: ReturnType<typeof useMemberInviteSearch>;
let scope: any;
function Probe({ query, enabled = true }: { query: string; enabled?: boolean }) { result = useMemberInviteSearch(query, scope, enabled); return null; }
const person = [{ id: 'sage', name: 'Sage', photo: null }];
const pending = () => { let resolve!: (value: any) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => act(async () => { jest.advanceTimersByTime(300); });
beforeEach(() => { jest.useFakeTimers(); mockSearch.mockReset().mockResolvedValue(person); scope = { userId: 'one', isCurrent: () => true }; });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });
it('debounces handle lookup and never searches short input', async () => {
 act(() => { tree = create(<Probe query="s" />); }); await tick(); expect(mockSearch).not.toHaveBeenCalled();
 act(() => tree.update(<Probe query="sa" />)); act(() => tree.update(<Probe query="sage" />)); await tick();
 expect(mockSearch).toHaveBeenCalledTimes(1); expect(mockSearch).toHaveBeenCalledWith('sage', 'one', { throwOnError: true }); expect(result.results).toEqual(person);
});
it('ignores older results and clears results while a new query is pending', async () => {
 const old = pending(); mockSearch.mockReturnValueOnce(old.promise); act(() => { tree = create(<Probe query="old" />); }); await tick();
 act(() => tree.update(<Probe query="sage" />)); expect(result.results).toEqual([]); expect(result.loading).toBe(true); await tick();
 await act(async () => old.resolve([{ id: 'old' }])); expect(result.results).toEqual(person);
 act(() => tree.update(<Probe query="s" />)); expect(result.results).toEqual([]); expect(result.loading).toBe(false);
});
it('separates a search error from empty results and lets the same query retry', async () => {
 mockSearch.mockRejectedValueOnce(Error('offline')); act(() => { tree = create(<Probe query="sage" />); }); await tick(); expect(result.error).toBe(true);
 act(() => result.retry()); expect(result.error).toBe(false); expect(result.loading).toBe(true); await tick(); expect(result.results).toEqual(person);
});
it('retires results on close, account change and unmount', async () => {
 const old = pending(); mockSearch.mockReturnValueOnce(old.promise); act(() => { tree = create(<Probe query="sage" />); }); await tick();
 scope.isCurrent = () => false; scope = { userId: 'two', isCurrent: () => true }; act(() => tree.update(<Probe query="sage" enabled={false} />));
 await act(async () => old.resolve(person)); expect(result.results).toEqual([]); expect(result.error).toBe(false);
 act(() => tree.update(<Probe query="sage" />)); await tick(); expect(mockSearch).toHaveBeenLastCalledWith('sage', 'two', { throwOnError: true });
 act(() => tree.update(<Probe query="another" />)); act(() => tree.unmount()); await tick(); expect(mockSearch).toHaveBeenCalledTimes(2);
});
it('does not reuse an earlier result after changing away and back to a query', async () => {
 act(() => { tree = create(<Probe query="sage" />); }); await tick(); act(() => tree.update(<Probe query="other" />)); act(() => tree.update(<Probe query="sage" />));
 expect(result.results).toEqual([]); expect(result.loading).toBe(true); await tick(); expect(mockSearch).toHaveBeenCalledTimes(2);
});
