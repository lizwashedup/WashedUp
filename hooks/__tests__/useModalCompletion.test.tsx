import React from 'react';
import { act, create } from 'react-test-renderer';
import { Platform } from 'react-native';
import { useModalCompletion } from '../useModalCompletion';

const cleanup: Array<() => void> = [];
function mount() {
  let owner = {}, current = true;
  const done = jest.fn();
  let latest!: ReturnType<typeof useModalCompletion>;
  function Harness({ token }: { token: object }) {
    latest = useModalCompletion(token, done, () => current);
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness token={owner} />); });
  let mounted = true;
  const unmount = () => { if (mounted) { act(() => tree.unmount()); mounted = false; } };
  cleanup.push(unmount);
  return { done, get value() { return latest; }, unmount,
    retireIdentity: () => { current = false; },
    reopen: () => { owner = {}; act(() => tree.update(<Harness token={owner} />)); },
  };
}
afterEach(() => { cleanup.splice(0).forEach(close => close()); jest.restoreAllMocks(); });

it('waits for iOS dismissal and completes once even if close or dismissal repeats', () => {
  const h = mount(); const close = h.value.requestClose;
  act(() => { close(); close(); });
  expect(h.value.closing).toBe(true); expect(h.done).not.toHaveBeenCalled();
  act(() => { h.value.onDismiss(); h.value.onDismiss(); close(); });
  expect(h.done).toHaveBeenCalledTimes(1);
});
it.each(['account', 'unmount', 'reopen'] as const)('discards a pending completion after %s', change => {
  const h = mount(); act(() => h.value.requestClose()); const oldDismiss = h.value.onDismiss;
  if (change === 'account') h.retireIdentity();
  else if (change === 'unmount') h.unmount();
  else h.reopen();
  act(() => oldDismiss()); expect(h.done).not.toHaveBeenCalled();
});
it('does not let an old native dismissal complete a newly reopened modal', () => {
  const h = mount(); act(() => h.value.requestClose()); const oldDismiss = h.value.onDismiss;
  h.reopen(); act(() => h.value.requestClose());
  act(() => oldDismiss()); expect(h.done).not.toHaveBeenCalled();
  act(() => h.value.onDismiss()); expect(h.done).toHaveBeenCalledTimes(1);
});
it('continues an empty optional step immediately when no native modal appeared', () => {
  const h = mount(); act(() => h.value.requestClose(false));
  expect(h.done).toHaveBeenCalledTimes(1);
});
it('keeps Android completion available without an iOS-only dismissal event', () => {
  const original = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    const h = mount(); act(() => h.value.requestClose()); expect(h.done).toHaveBeenCalledTimes(1);
  } finally { Object.defineProperty(Platform, 'OS', original); }
});
