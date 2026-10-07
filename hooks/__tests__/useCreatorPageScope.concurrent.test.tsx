import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCreatorPageScope } from '../useCreatorPageScope';
let mockViewer = 'owner', mockEpoch = 1, mockFocused = true;
jest.mock('../useObservedUser', () => ({ useObservedUser: () => {
  const React = require('react'), viewerId = mockViewer, epoch = mockEpoch;
  const isCurrent = React.useCallback(() => mockViewer === viewerId && mockEpoch === epoch, [viewerId, epoch]);
  return { viewerId, epoch, isCurrent };
} }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
beforeEach(() => { mockViewer = 'owner'; mockEpoch = 1; mockFocused = true; });
const never = new Promise(() => {});
function Child(_: { scope: ReturnType<typeof useCreatorPageScope>['scope'] }) { return null; }
function Probe({ pageId, suspend }: { pageId: string; suspend: boolean }) {
  const { scope } = useCreatorPageScope(pageId);
  if (suspend) throw never;
  return <Child scope={scope} />;
}
it('retains the committed creator visit while a different page render remains uncommitted', async () => {
  let tree!: ReactTestRenderer;
  const render = (pageId: string, suspend: boolean) => <React.Suspense fallback={null}><Probe pageId={pageId} suspend={suspend} /></React.Suspense>;
  try {
    await act(async () => { tree = create(render('joining:page', false)); });
    const committed = tree.root.findByType(Child).props.scope;
    expect(committed.isCurrent()).toBe(true);
    await act(async () => { React.startTransition(() => tree.update(render('joining:other-page', true))); });
    expect(tree.root.findByType(Child).props.scope).toBe(committed);
    expect(committed.isCurrent()).toBe(true);
  } finally { act(() => tree.unmount()); }
});

it.each(['page', 'focus', 'account'])('retires prior callbacks after a committed %s roundtrip and enables the returning visit', async mode => {
  let tree!: ReactTestRenderer;
  const render = (pageId = 'joining:page') => <Probe pageId={pageId} suspend={false} />;
  try {
    await act(async () => { tree = create(render()); });
    const first = tree.root.findByType(Child).props.scope;
    if (mode === 'page') {
      act(() => { tree.update(render('joining:other-page')); });
      expect(first.isCurrent()).toBe(false);
      act(() => { tree.update(render()); });
    } else if (mode === 'focus') {
      mockFocused = false; act(() => { tree.update(render()); });
      expect(first.isCurrent()).toBe(false);
      expect(tree.root.findByType(Child).props.scope.isCurrent()).toBe(false);
      mockFocused = true; act(() => { tree.update(render()); });
    } else {
      mockViewer = 'other'; mockEpoch++;
      // This models the real observer's synchronous auth invalidation before
      // React can commit any different-account screen.
      expect(first.isCurrent()).toBe(false);
      act(() => { tree.update(render()); });
      mockViewer = 'owner'; mockEpoch++; act(() => { tree.update(render()); });
    }
    const returning = tree.root.findByType(Child).props.scope;
    expect(returning).not.toBe(first);
    expect(first.isCurrent()).toBe(false);
    expect(returning.isCurrent()).toBe(true);
    act(() => tree.unmount());
    expect(returning.isCurrent()).toBe(false);
  } finally { act(() => tree.unmount()); }
});
