import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform } from 'react-native';
import PlanChooserSheet from '../PlanChooserSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const select = jest.fn(), start = jest.fn(), close = jest.fn();
const plans = [{ id: 'plan', title: 'Walk together', creator_name: 'Alex', creator_photo: null, spotsText: '3 spots left', isFull: false }];
let tree: ReactTestRenderer;
const originalPlatform = Platform.OS;
const render = (visible = true) => <PlanChooserSheet visible={visible} plans={plans} onSelectPlan={select} onStartNew={start} onClose={close} />;
const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const modal = () => tree.root.findByType(Modal);
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  act(() => { tree = create(render()); });
});
afterEach(() => { act(() => tree.unmount()); Platform.OS = originalPlatform; });

it('waits for native dismissal before selecting the group', () => {
  act(() => button('Walk together').props.onPress());
  expect(select).not.toHaveBeenCalled();
  expect(modal().props.visible).toBe(false);
  act(() => modal().props.onDismiss());
  expect(select).toHaveBeenCalledWith('plan');
});
it('coalesces repeated row taps while closing', () => {
  const press = button('Walk together').props.onPress;
  act(() => { press(); press(); });
  expect(select).not.toHaveBeenCalled();
  const finish = modal().props.onDismiss;
  act(() => { finish(); finish(); press(); });
  expect(select).toHaveBeenCalledTimes(1);
});
it('waits before opening creation', () => {
  act(() => button('Start a plan').props.onPress());
  expect(start).not.toHaveBeenCalled();
  act(() => modal().props.onDismiss());
  expect(start).toHaveBeenCalledTimes(1);
});
it.each(['hide', 'reopen', 'unmount'])('retires queued navigation after %s', change => {
  act(() => button('Walk together').props.onPress());
  const finish = modal().props.onDismiss;
  if (change === 'unmount') act(() => tree.unmount());
  else {
    act(() => tree.update(render(false)));
    if (change === 'reopen') act(() => tree.update(render()));
  }
  act(() => finish());
  expect(select).not.toHaveBeenCalled();
});
it('selects on Android without waiting for an iOS-only event', () => {
  Platform.OS = 'android';
  act(() => button('Walk together').props.onPress());
  expect(select).toHaveBeenCalledWith('plan');
});
it('closes once without selecting or creating', () => {
  const press = button('Close plan picker').props.onPress;
  act(() => { press(); press(); });
  expect(close).not.toHaveBeenCalled();
  act(() => modal().props.onDismiss());
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});
it('keeps the first action when a different action is tapped during closure', () => {
  const choose = button('Walk together').props.onPress;
  const createPlan = button('Start a plan').props.onPress;
  act(() => { choose(); createPlan(); });
  act(() => modal().props.onDismiss());
  expect(select).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
});
it('opens a fresh visit and ignores a callback retained from the old visit', () => {
  act(() => button('Walk together').props.onPress());
  const oldFinish = modal().props.onDismiss;
  act(() => tree.update(render(false)));
  act(() => tree.update(render()));
  expect(modal().props.visible).toBe(true);
  act(() => button('Start a plan').props.onPress());
  act(() => oldFinish());
  expect(start).not.toHaveBeenCalled();
  act(() => modal().props.onDismiss());
  expect(start).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it('does nothing when native dismissal arrives without an action', () => {
  act(() => modal().props.onDismiss());
  expect(select).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
