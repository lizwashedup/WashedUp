import React from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlanJoinSheet, type PlanJoinSheetProps } from '../PlanJoinSheet';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowFonts } from '../../../constants/Typography';

let mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));

const appearance = { fonts: AfterglowFonts };
const cleanup: Array<() => void> = [];
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(extra: Partial<PlanJoinSheetProps> = {}) {
  const callbacks = { onMessage: jest.fn(), onConfirmed: jest.fn(), onJoin: jest.fn(), onClose: jest.fn(), onDismiss: jest.fn(), onCheck: jest.fn() };
  let props: PlanJoinSheetProps = {
    visible: true, planId: 'plan-a', planTitle: 'A slow Sunday walk', dateLabel: 'Sunday, September 20 at 10:00 AM',
    message: 'Hi everyone! Looking forward to it.', confirmed: true, error: null, busy: false, unconfirmed: false, canJoin: true,
    ...callbacks, ...extra,
  };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<PlanJoinSheet {...props} />); });
  const update = (patch: Partial<PlanJoinSheetProps> = {}) => { props = { ...props, ...patch }; act(() => tree.update(<PlanJoinSheet {...props} />)); };
  let removed = false;
  const unmount = () => { if (!removed) act(() => tree.unmount()); removed = true; };
  cleanup.push(unmount);
  const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
  return { tree, update, callbacks, button, unmount, input: () => tree.root.findByType(TextInput), modal: () => tree.root.findByType(Modal) };
}
beforeEach(() => {
  mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 };
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); jest.clearAllMocks(); });

it('retains the exact controlled greeting and requires a 200-character maximum plus explicit confirmation', async () => {
  const f = mount({ message: '', confirmed: false });
  expect(f.input().props).toMatchObject({ maxLength: 200, multiline: true, value: '' });
  act(() => { f.input().props.onChangeText(' Hello 👋 '); f.button("I'm coming").props.onPress(); });
  expect(f.callbacks.onMessage).toHaveBeenCalledWith(' Hello 👋 ');
  expect(f.callbacks.onConfirmed).toHaveBeenCalledWith(true);
  expect(f.input().props.value).toBe(''); // Parent owns the draft; presentation does not replace it.
  f.update({ message: ' Hello 👋 ', confirmed: true });
  await act(async () => f.button('Join').props.onPress());
  expect(f.callbacks.onJoin).toHaveBeenCalledTimes(1);
  expect(f.callbacks.onMessage).toHaveBeenCalledTimes(1);
});

it.each([
  { message: '' }, { message: '  \n ' }, { confirmed: false }, { canJoin: false }, { message: 'x'.repeat(201) },
])('does not submit when a required gate is missing: %j', async patch => {
  const f = mount(patch);
  expect(f.button('Join').props.accessibilityState.disabled).toBe(true);
  await act(async () => f.button('Join').props.onPress());
  expect(f.callbacks.onJoin).not.toHaveBeenCalled();
});

it('blocks duplicate join, edits, checkbox and every close route synchronously while a callback is pending', async () => {
  const pending = deferred(), f = mount({ onJoin: () => pending.promise });
  const join = f.button('Join').props.onPress, close = f.button('Close').props.onPress;
  const change = f.input().props.onChangeText, confirm = f.button("I'm coming").props.onPress;
  const nativeClose = f.modal().props.onRequestClose;
  act(() => { join(); join(); change('Changed'); confirm(); close(); nativeClose(); });
  expect(f.input().props.editable).toBe(false);
  expect(f.button('Joining…').props.accessibilityState).toEqual({ busy: true, disabled: true });
  expect(f.callbacks.onMessage).not.toHaveBeenCalled(); expect(f.callbacks.onConfirmed).not.toHaveBeenCalled();
  expect(f.callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(f.input().props.editable).toBe(true);
  act(() => close()); expect(f.callbacks.onClose).toHaveBeenCalledTimes(1);
});

it('honors external preparation busy before the sheet starts any action', async () => {
  const f = mount({ busy: true });
  await act(async () => {
    f.button('Joining…').props.onPress(); f.modal().props.onRequestClose();
    f.button('Close').props.onPress(); f.input().props.onChangeText('new'); f.button("I'm coming").props.onPress();
  });
  Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
});

it('closes once without clearing the greeting or checkbox', () => {
  const f = mount();
  act(() => { f.button('Close').props.onPress(); f.modal().props.onRequestClose(); f.modal().props.onAccessibilityEscape(); });
  expect(f.callbacks.onClose).toHaveBeenCalledTimes(1);
  expect(f.callbacks.onMessage).not.toHaveBeenCalled(); expect(f.callbacks.onConfirmed).not.toHaveBeenCalled();
  expect(f.input().props.value).toBe('Hi everyone! Looking forward to it.');
});

it('keeps the current native dismiss callback after hiding, and delivers it only once', () => {
  const f = mount(), latestDismiss = jest.fn();
  act(() => f.modal().props.onDismiss()); expect(f.callbacks.onDismiss).not.toHaveBeenCalled();
  f.update({ visible: false, onDismiss: latestDismiss });
  act(() => { f.modal().props.onDismiss(); f.modal().props.onDismiss(); });
  expect(latestDismiss).toHaveBeenCalledTimes(1); expect(f.callbacks.onDismiss).not.toHaveBeenCalled();
});

it('ignores hidden initial native dismissal and hidden action callbacks', async () => {
  const f = mount({ visible: false });
  await act(async () => { f.modal().props.onDismiss(); f.modal().props.onRequestClose(); });
  Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
});

it.each(['reopen', 'target'] as const)('retires old callbacks and native dismissal after a %s', async change => {
  const f = mount();
  const join = f.button('Join').props.onPress, close = f.button('Close').props.onPress;
  const input = f.input().props.onChangeText, checkbox = f.button("I'm coming").props.onPress, dismiss = f.modal().props.onDismiss;
  if (change === 'reopen') { f.update({ visible: false }); f.update({ visible: true }); }
  else f.update({ planId: 'plan-b' }); // Exact same title and date.
  await act(async () => { join(); close(); input('old'); checkbox(); dismiss(); });
  Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  await act(async () => f.button('Join').props.onPress());
  expect(f.callbacks.onJoin).toHaveBeenCalledTimes(1);
});

it('retires retained callbacks after unmount', async () => {
  const f = mount(), join = f.button('Join').props.onPress, dismiss = f.modal().props.onDismiss;
  f.unmount(); await act(async () => { join(); dismiss(); });
  Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
});

it('late failure from a previous plan cannot show an error or lock the new visit', async () => {
  const pending = deferred(), first = jest.fn(() => pending.promise), current = jest.fn();
  const f = mount({ onJoin: first });
  act(() => f.button('Join').props.onPress());
  f.update({ planId: 'plan-b', onJoin: current });
  await act(async () => pending.reject(new Error('late failure')));
  expect(f.tree.root.findAll(node => node.props.accessibilityRole === 'alert')).toHaveLength(0);
  await act(async () => f.button('Join').props.onPress());
  expect(first).toHaveBeenCalledTimes(1); expect(current).toHaveBeenCalledTimes(1);
});

it('uses Check plan for an unknown receipt, retaining the greeting and preventing another join', async () => {
  const pending = deferred(), check = jest.fn(() => pending.promise);
  const f = mount({ unconfirmed: true, canJoin: false, onCheck: check });
  expect(f.button('Join')).toBeUndefined(); expect(f.input().props.editable).toBe(false);
  const action = f.button('Check plan').props.onPress;
  act(() => { action(); action(); f.button('Close').props.onPress(); });
  expect(check).toHaveBeenCalledTimes(1); expect(f.callbacks.onJoin).not.toHaveBeenCalled();
  expect(f.callbacks.onClose).not.toHaveBeenCalled();
  expect(f.button('Checking…').props.accessibilityState.busy).toBe(true);
  await act(async () => pending.resolve());
  expect(f.button('Check plan')).toBeDefined(); expect(f.input().props.value).toBe('Hi everyone! Looking forward to it.');
});

it('keeps failed checks retryable without exposing provider errors or submitting again', async () => {
  const check = jest.fn().mockRejectedValueOnce(new Error('private transport details')).mockResolvedValueOnce(undefined);
  const f = mount({ unconfirmed: true, onCheck: check });
  await act(async () => f.button('Check plan').props.onPress());
  expect(f.tree.root.findAllByType(Text).some(node => node.props.children === 'Couldn’t check the plan. Try checking again.')).toBe(true);
  await act(async () => f.button('Check plan').props.onPress());
  expect(check).toHaveBeenCalledTimes(2); expect(f.callbacks.onJoin).not.toHaveBeenCalled();
});

it('unexpected thrown join callbacks cannot invite a blind duplicate', async () => {
  const onJoin = jest.fn().mockRejectedValue(new Error('unexpected failure')), f = mount({ onJoin });
  const oldJoin = f.button('Join').props.onPress;
  await act(async () => oldJoin());
  expect(f.button('Join')).toBeUndefined(); expect(f.button('Check plan')).toBeDefined();
  await act(async () => oldJoin());
  expect(onJoin).toHaveBeenCalledTimes(1); expect(f.callbacks.onCheck).toHaveBeenCalledTimes(1);
});

it('preserves ordinary retry after the caller reports a definite rejection', async () => {
  const f = mount();
  await act(async () => f.button('Join').props.onPress());
  f.update({ error: 'This plan filled up. Choose another plan.', canJoin: false });
  expect(f.input().props.value).toBe('Hi everyone! Looking forward to it.');
  expect(f.button('Join').props.disabled).toBe(true);
  expect(f.tree.root.findAllByType(Text).some(node => node.props.children === 'This plan filled up. Choose another plan.')).toBe(true);
  f.update({ error: null, canJoin: true });
  await act(async () => f.button('Join').props.onPress()); expect(f.callbacks.onJoin).toHaveBeenCalledTimes(2);
});

it('keeps long content in the short-screen scroll area above the safe-area footer', () => {
  mockWindow = { width: 320, height: 500, scale: 1, fontScale: 1.8 };
  const f = mount({ appearance, planTitle: 'A long plan title that should remain readable and scroll with the form' });
  const scroll = f.tree.root.findByType(ScrollView), input = f.input(), title = scroll.findAllByType(Text).find(node => node.props.accessibilityRole === 'header')!;
  expect(scroll.findByType(TextInput)).toBe(input); expect(title.props.numberOfLines).toBeUndefined();
  expect(scroll.findAllByType(TouchableOpacity).some(node => node.props.accessibilityLabel === 'Join')).toBe(false);
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 });
  const sheet = f.tree.root.findAll(node => node.props.testID === 'plan-join-sheet')[0];
  expect(StyleSheet.flatten(sheet.props.style)).toMatchObject({ maxHeight: 452, paddingBottom: 28 });
  expect(StyleSheet.flatten(f.button('Join').props.style)).toMatchObject({ minHeight: 48, borderRadius: 4 });
  expect(StyleSheet.flatten(f.button('Close').props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
  expect(f.tree.root.findByType(KeyboardAvoidingView).props.behavior).toBeDefined();
});

it('retains legacy defaults and opts into title-first cream/Mona with the same input and checkbox', () => {
  const f = mount();
  let title = f.tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'header')!;
  expect(title.props.children).toBe("You're joining A slow Sunday walk");
  expect(StyleSheet.flatten(f.input().props.style).backgroundColor).toBe(Colors.white);
  f.update({ appearance });
  title = f.tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'header')!;
  expect(title.props.children).toBe('A slow Sunday walk');
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe(AfterglowFonts.display);
  const sheet = f.tree.root.findAll(node => node.props.testID === 'plan-join-sheet')[0];
  expect(StyleSheet.flatten(sheet.props.style).backgroundColor).toBe(AfterglowColors.paper);
  expect(f.button("I'm coming").props.accessibilityState.checked).toBe(true);
  expect(f.input().props.value).toBe('Hi everyone! Looking forward to it.');
});
