import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCreatorPageRead } from '../useCreatorPageRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
let current: ReturnType<typeof useCreatorPageRead<string>>;
function Harness({ scope, read }: { scope: CreatorPageScope; read: (scope: CreatorPageScope) => Promise<string> }) {
  current = useCreatorPageRead(scope, read); return null;
}
const deferred = () => { let resolve!: (s: string) => void; const promise = new Promise<string>(r => { resolve = r; }); return { promise, resolve }; };
it('hides private content immediately on account/page change and ignores the old response', async () => {
  let aCurrent = true; const a = { userId: 'a', isCurrent: () => aCurrent }, b = { userId: 'b', isCurrent: () => true };
  const slow = deferred(); const read = jest.fn().mockResolvedValueOnce('A private page').mockReturnValueOnce(slow.promise).mockResolvedValueOnce('B page');
  let tree!: ReactTestRenderer; await act(async () => { tree = create(<Harness scope={a} read={read} />); });
  expect(current.data).toBe('A private page');
  let pending: Promise<unknown>; act(() => { pending = current.refresh(); });
  aCurrent = false; await act(async () => { tree.update(<Harness scope={b} read={read} />); });
  expect(current.data).toBe('B page'); await act(async () => { slow.resolve('Old A'); await pending; });
  expect(current.data).toBe('B page'); act(() => tree.unmount());
});
it('retains current data on a read failure and permits read-only recovery', async () => {
  const scope = { userId: 'a', isCurrent: () => true };
  const read = jest.fn().mockResolvedValueOnce('Approved private').mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce('Published');
  let tree!: ReactTestRenderer; await act(async () => { tree = create(<Harness scope={scope} read={read} />); });
  await act(async () => { await current.refresh().catch(() => undefined); });
  expect(current.data).toBe('Approved private'); expect(current.error).toBe('Offline');
  await act(async () => { await current.refresh(); }); expect(current.data).toBe('Published'); expect(current.error).toBeUndefined();
  act(() => tree.unmount());
});
