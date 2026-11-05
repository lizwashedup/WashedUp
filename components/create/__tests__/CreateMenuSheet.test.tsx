import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, ScrollView } from 'react-native';
import CreateMenuSheet from '../CreateMenuSheet';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
jest.mock('../../yours/a11y/useReduceMotion', () => ({ useReduceMotion: () => false }));
const select = jest.fn(), close = jest.fn();
const originalPlatform = Platform.OS;
let tree: ReactTestRenderer;
const render = (visible = true) => <CreateMenuSheet visible={visible} onClose={close} onSelect={select} />;
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const modal = () => tree.root.findByType(Modal);
beforeEach(() => { jest.clearAllMocks(); Platform.OS = 'ios'; act(() => { tree = create(render()); }); });
afterEach(() => { act(() => tree.unmount()); Platform.OS = originalPlatform; });

it.each([['Make a plan', 'plan'], ['Create an event', 'event'], ['Start a community', 'community']])('opens %s only after iOS dismissal', (label, kind) => {
  act(() => button(label).props.onPress());
  expect(select).not.toHaveBeenCalled();
  expect(modal().props.visible).toBe(false);
  act(() => modal().props.onDismiss());
  expect(select).toHaveBeenCalledWith(kind);
});
it('accepts only the first action during dismissal', () => {
  const plan = button('Make a plan').props.onPress, event = button('Create an event').props.onPress;
  act(() => { plan(); event(); plan(); });
  const finish = modal().props.onDismiss;
  act(() => { finish(); finish(); });
  expect(select.mock.calls).toEqual([['plan']]);
});
it.each(['close', 'back'])('cancels through %s without a destination', action => {
  act(() => action === 'close' ? button('Close create menu').props.onPress() : modal().props.onRequestClose());
  act(() => modal().props.onDismiss());
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it.each(['hide', 'unmount'])('retires navigation when the parent must %s the menu', change => {
  act(() => button('Create an event').props.onPress());
  const finish = modal().props.onDismiss;
  act(() => change === 'hide' ? tree.update(render(false)) : tree.unmount());
  act(() => finish());
  expect(select).not.toHaveBeenCalled();
});
it('ignores an old native callback after reopening', () => {
  act(() => button('Make a plan').props.onPress());
  const oldFinish = modal().props.onDismiss;
  act(() => tree.update(render(false)));
  act(() => tree.update(render()));
  act(() => button('Start a community').props.onPress());
  act(() => oldFinish());
  expect(select).not.toHaveBeenCalled();
  act(() => modal().props.onDismiss());
  expect(select.mock.calls).toEqual([['community']]);
});
it('opens on Android without waiting for an iOS event', () => {
  Platform.OS = 'android';
  act(() => button('Make a plan').props.onPress());
  expect(select).toHaveBeenCalledWith('plan');
});
it('keeps all three explained choices in a scrollable container', () => {
  const content = tree.root.findByType(ScrollView);
  for (const label of ['Make a plan', 'Create an event', 'Start a community']) {
    expect(content.findAll(node => node === button(label))).toHaveLength(1);
    expect(button(label).props.accessibilityHint).toBeTruthy();
  }
});
