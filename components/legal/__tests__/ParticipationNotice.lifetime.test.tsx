import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Text, TouchableOpacity } from 'react-native';
import { ParticipationNotice } from '../ParticipationNotice';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('lucide-react-native', () => ({ X: () => null, Check: () => null }));

const cleanup: Array<() => void> = [];
function deferred() {
  let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(extra: Partial<React.ComponentProps<typeof ParticipationNotice>> = {}) {
  const onClose = jest.fn(), onDismiss = jest.fn(), onAgree = jest.fn().mockResolvedValue(true);
  let props = { visible: true, organizerName: 'Amelia', onClose, onDismiss, onAgree, ...extra };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<ParticipationNotice {...props} />); });
  let mounted = true;
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; }; cleanup.push(unmount);
  return { tree, onClose, onDismiss, onAgree, unmount,
    update(next: Partial<typeof props>) { props = { ...props, ...next }; act(() => tree.update(<ParticipationNotice {...props} />)); },
    modal: () => tree.root.findByType(Modal),
    checkbox: () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityRole === 'checkbox')!,
    close: () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Close')!,
    agree: () => tree.root.findAllByType(TouchableOpacity).at(-1)!,
  };
}
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.clearAllMocks(); });

it('requires an explicit unchecked-to-checked action and preserves the consent body', async () => {
  const f = mount(); expect(f.checkbox().props.accessibilityState.checked).toBe(false);
  await act(async () => f.agree().props.onPress()); expect(f.onAgree).not.toHaveBeenCalled();
  const text = f.tree.root.findAllByType(Text).flatMap(node => [node.props.children].flat(Infinity)).filter(value => typeof value === 'string').join(' ');
  expect(text).toContain('WashedUp provides software for discovery, communication, and coordination.');
  expect(text).toContain('assumption-of-risk, release, and limitation provisions in the WashedUp');
  act(() => f.checkbox().props.onPress()); await act(async () => f.agree().props.onPress()); expect(f.onAgree).toHaveBeenCalledTimes(1);
});

it('immediately locks duplicate agreement, closing and checkbox changes while awaiting the caller', async () => {
  const pending = deferred(), onAgree = jest.fn(() => pending.promise), f = mount({ onAgree });
  act(() => f.checkbox().props.onPress());
  const agree = f.agree().props.onPress, checkbox = f.checkbox().props.onPress;
  act(() => { void agree(); void agree(); checkbox(); f.close().props.onPress(); f.modal().props.onRequestClose(); });
  expect(onAgree).toHaveBeenCalledTimes(1); expect(f.onClose).not.toHaveBeenCalled(); expect(f.checkbox().props.accessibilityState.checked).toBe(true);
  await act(async () => pending.resolve(false));
  expect(f.tree.root.findAllByType(Text).some(node => node.props.children === 'that did not go through. give it another try.')).toBe(true);
});

it('still delivers native dismissal while the successful assent callback waits for that dismissal', async () => {
  const pending = deferred(), f = mount({ onAgree: () => pending.promise });
  act(() => f.checkbox().props.onPress()); act(() => { void f.agree().props.onPress(); });
  f.update({ visible: false });
  act(() => { f.modal().props.onDismiss(); f.modal().props.onDismiss(); }); expect(f.onDismiss).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(true));
});

it('does not announce dismissal for a still-visible or never-opened notice', () => {
  const f = mount({ visible: false }); act(() => f.modal().props.onDismiss()); expect(f.onDismiss).not.toHaveBeenCalled();
  f.update({ visible: true }); act(() => f.modal().props.onDismiss()); expect(f.onDismiss).not.toHaveBeenCalled();
});

it('one close request retires callbacks until the parent hides the notice', async () => {
  const f = mount(); act(() => f.checkbox().props.onPress());
  act(() => { f.close().props.onPress(); f.modal().props.onRequestClose(); });
  await act(async () => f.agree().props.onPress()); expect(f.onClose).toHaveBeenCalledTimes(1); expect(f.onAgree).not.toHaveBeenCalled();
});

it('a new visible visit starts unchecked and rejects old close, agree and native-dismiss callbacks', async () => {
  const f = mount(); act(() => f.checkbox().props.onPress());
  const oldAgree = f.agree().props.onPress, oldClose = f.close().props.onPress, oldDismiss = f.modal().props.onDismiss;
  f.update({ visible: false }); f.update({ visible: true });
  expect(f.checkbox().props.accessibilityState.checked).toBe(false);
  await act(async () => { await oldAgree(); oldClose(); oldDismiss(); });
  expect(f.onAgree).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(f.onDismiss).not.toHaveBeenCalled();
});

it('a late rejected agreement cannot show an error in a reopened notice', async () => {
  const pending = deferred(), f = mount({ onAgree: () => pending.promise });
  act(() => f.checkbox().props.onPress()); act(() => { void f.agree().props.onPress(); });
  f.update({ visible: false }); f.update({ visible: true });
  await act(async () => pending.reject(new Error('old response')));
  expect(f.checkbox().props.accessibilityState.checked).toBe(false);
  expect(f.tree.root.findAllByType(Text).some(node => node.props.children === 'that did not go through. give it another try.')).toBe(false);
});

it('catches a current rejection using the unchanged retry copy and permits another explicit agreement', async () => {
  const onAgree = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true), f = mount({ onAgree });
  act(() => f.checkbox().props.onPress()); await act(async () => f.agree().props.onPress());
  expect(f.tree.root.findAllByType(Text).some(node => node.props.children === 'that did not go through. give it another try.')).toBe(true);
  await act(async () => f.agree().props.onPress()); expect(onAgree).toHaveBeenCalledTimes(2);
});

it('ignores late native callbacks after unmount, while optional onDismiss remains compatible', () => {
  const f = mount({ onDismiss: undefined }), dismiss = f.modal().props.onDismiss;
  f.unmount(); expect(() => dismiss()).not.toThrow();
});
