import React from 'react';
import { Animated, Keyboard, Platform, StyleSheet, Text, View, type KeyboardEvent, type KeyboardEventName } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { IOSKeyboardDock, IOSKeyboardViewport } from '../ChatKeyboard.native';

// Keep one real RN Animated.Value for the complete gesture. This checks the
// adapter's native graph/footprint contract without mocking its implementation.
jest.mock('react-native-keyboard-controller', () => {
  const { Animated } = require('react-native');
  const height = new Animated.Value(0);
  return {
    KeyboardProvider: ({ children }: any) => children,
    KeyboardAvoidingView: jest.fn(() => null),
    useKeyboardAnimation: () => ({ height }),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 4 } }),
    __testHeight: height,
  };
});
jest.mock('react-native-reanimated', () => ({
  useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 4 } }),
  useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
}));

type Subscription = { name: KeyboardEventName; listener: (event: KeyboardEvent) => void; active: boolean; remove: jest.Mock };
let tree: ReactTestRenderer | undefined;
let subscriptions: Subscription[];
let initialHeight: number | undefined;
const keyboardHeight = () => jest.requireMock('react-native-keyboard-controller').__testHeight as Animated.Value;
const event = (height: number) => ({ endCoordinates: { height, screenY: 800 - height, screenX: 0, width: 390 }, duration: 250, easing: 'keyboard' }) as KeyboardEvent;
function emit(name: KeyboardEventName, height = 0) {
  act(() => subscriptions.filter(entry => entry.active && entry.name === name).forEach(entry => entry.listener(event(height))));
}
function motion(height: number) { act(() => keyboardHeight().setValue(-height)); }
function shell(inset: number) {
  return <>
    <IOSKeyboardViewport inset={inset} testID="history" style={{ flex: 1 }}>
      <Text>Conversation history</Text>
    </IOSKeyboardViewport>
    <IOSKeyboardDock inset={inset} testID="composer"><Text>Message</Text></IOSKeyboardDock>
  </>;
}
function mount(inset = 0) { act(() => { tree = create(shell(inset)); }); }
function updateInset(inset: number) { act(() => tree!.update(shell(inset))); }
function animatedStyle(kind: 'viewport' | 'dock') {
  const nodes = tree!.root.findAllByType(Animated.View);
  const node = kind === 'dock'
    ? nodes.find(candidate => candidate.props.testID === 'composer')!
    : nodes.find(candidate => StyleSheet.flatten(candidate.props.style)?.paddingTop !== undefined)!;
  return StyleSheet.flatten(node.props.style) as any;
}
function translation(kind: 'viewport' | 'dock') {
  const value = animatedStyle(kind).transform[0].translateY;
  return typeof value === 'number' ? value : value.__getValue();
}
function reservation() { return animatedStyle('viewport').paddingTop; }

beforeEach(() => {
  subscriptions = []; initialHeight = undefined;
  jest.replaceProperty(Platform, 'OS', 'ios');
  keyboardHeight().setValue(0);
  jest.spyOn(Keyboard, 'metrics').mockImplementation(() => initialHeight === undefined ? undefined : event(initialHeight).endCoordinates);
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: KeyboardEventName, listener: (event: KeyboardEvent) => void) => {
    const entry = { name, listener, active: true, remove: jest.fn() };
    entry.remove.mockImplementation(() => { entry.active = false; });
    subscriptions.push(entry);
    return { remove: entry.remove };
  }) as unknown as typeof Keyboard.addListener);
});
afterEach(() => {
  act(() => { tree?.unmount(); }); tree = undefined;
  jest.restoreAllMocks();
});

it('releases every keyboard listener through 40 visits with repeated keyboard/panel handoffs', () => {
  for (let visit = 0; visit < 40; visit++) {
    mount(34);
    expect(subscriptions.filter(entry => entry.active)).toHaveLength(3);
    for (const height of [300, 432, 280]) {
      motion(height); emit('keyboardDidShow', height);
      expect(reservation()).toBe(height);
      updateInset(240);
      expect([translation('viewport'), translation('dock')]).toEqual([-height, -height]);
      emit('keyboardWillHide'); motion(0); emit('keyboardDidHide');
      expect(reservation()).toBe(240);
      expect([translation('viewport'), translation('dock')]).toEqual([-240, -240]);
      updateInset(34);
      expect(reservation()).toBe(34);
    }
    act(() => tree!.unmount()); tree = undefined;
    expect(subscriptions.filter(entry => entry.active)).toHaveLength(0);
  }
  expect(subscriptions).toHaveLength(120);
  expect(subscriptions.every(entry => entry.remove.mock.calls.length === 1)).toBe(true);
});

it('matches the larger keyboard or panel/safe-area footprint at exact handoff boundaries', () => {
  mount();
  for (const inset of [0, 34, 180, 240]) {
    updateInset(inset);
    // Include both sides of the floor and the exact equality boundary. Heights
    // beyond 320 ensure the graph does not clamp to a single keyboard size.
    for (const height of [0, 17, 34, 120, 180, 240, 320, 432]) {
      motion(height);
      const expected = Math.min(-height, -inset) || 0;
      expect([translation('viewport'), translation('dock')]).toEqual([expected, expected]);
      expect(reservation()).toBe(inset);
    }
  }
});

it('keeps the same native graph attached across inset changes while the keyboard moves', () => {
  mount(34); motion(320);
  const viewportGraph = animatedStyle('viewport').transform[0].translateY;
  const dockGraph = animatedStyle('dock').transform[0].translateY;
  const handoff = [
    { inset: 180, height: 280, expected: -280 },
    { inset: 180, height: 120, expected: -180 },
    { inset: 240, height: 100, expected: -240 },
    { inset: 34, height: 300, expected: -300 },
    { inset: 34, height: 0, expected: -34 },
    { inset: 0, height: 0, expected: 0 },
  ];
  for (const step of handoff) {
    motion(step.height); updateInset(step.inset);
    expect(animatedStyle('viewport').transform[0].translateY).toBe(viewportGraph);
    expect(animatedStyle('dock').transform[0].translateY).toBe(dockGraph);
    expect([translation('viewport'), translation('dock')]).toEqual([step.expected, step.expected]);
  }
  // The viewport's settled reservation also rerenders without detaching motion.
  motion(320); emit('keyboardDidShow', 320);
  expect(animatedStyle('viewport').transform[0].translateY).toBe(viewportGraph);
  expect(animatedStyle('dock').transform[0].translateY).toBe(dockGraph);
  emit('keyboardWillHide'); motion(0);
  expect(animatedStyle('viewport').transform[0].translateY).toBe(viewportGraph);
  expect(animatedStyle('dock').transform[0].translateY).toBe(dockGraph);
});

it('reserves the keyboard footprint only when opening settles and clears it as hiding begins', () => {
  mount(34);
  motion(160);
  expect(reservation()).toBe(34);
  motion(320);
  expect(reservation()).toBe(34);
  emit('keyboardDidShow', 320);
  expect(reservation()).toBe(320);
  expect(translation('viewport')).toBe(-320);
  // The panel stays as a floor after the keyboard's settled reservation clears.
  updateInset(180);
  emit('keyboardWillHide');
  expect(reservation()).toBe(180);
  motion(0);
  expect([translation('viewport'), translation('dock')]).toEqual([-180, -180]);
  emit('keyboardDidHide');
  expect(reservation()).toBe(180);
});

it('starts with the existing keyboard footprint when a room is opened with the keyboard already visible', () => {
  initialHeight = 300; motion(300); mount(34);
  expect(reservation()).toBe(300);
  expect([translation('viewport'), translation('dock')]).toEqual([-300, -300]);
  emit('keyboardDidShow', 260);
  expect(reservation()).toBe(260);
  // A native did-hide without a prior will-hide also clears the reservation.
  emit('keyboardDidHide');
  expect(reservation()).toBe(34);
});

it('removes every keyboard listener when a room retires and only updates the newly mounted room', () => {
  mount(34); emit('keyboardDidShow', 320);
  const retired = [...subscriptions];
  act(() => tree!.unmount()); tree = undefined;
  expect(retired.map(entry => entry.remove.mock.calls.length)).toEqual([1, 1, 1]);
  expect(subscriptions.filter(entry => entry.active)).toHaveLength(0);
  // A late emission with no mounted room has no target. The next room gets
  // only current metrics, never the previous room's reserved height.
  emit('keyboardDidShow', 500);
  mount(34);
  expect(reservation()).toBe(34);
  expect(subscriptions.filter(entry => entry.active)).toHaveLength(3);
  emit('keyboardDidShow', 280);
  expect(reservation()).toBe(280);
  expect(retired.every(entry => !entry.active)).toBe(true);
});

it.each(['ios', 'android'] as const)('uses the intended %s provider, hook and keyboard wrapper', platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  jest.isolateModules(() => {
    const rn = require('react-native');
    jest.replaceProperty(rn.Platform, 'OS', platform);
    const native = require('../ChatKeyboard.native');
    const controller = require('react-native-keyboard-controller');
    const reanimated = require('react-native-reanimated');
    expect(native.ChatKeyboardAvoidingView).toBe(platform === 'ios' ? controller.KeyboardAvoidingView : rn.KeyboardAvoidingView);
    expect(typeof native.useAnimatedKeyboard).toBe('function');
    expect(native.useAnimatedKeyboard).toBe(platform === 'ios' ? controller.useAnimatedKeyboard : reanimated.useAnimatedKeyboard);
    // This provider has no hooks. Inspect its returned boundary directly to
    // prove Android keeps children outside the controller/inset provider.
    const child = <Text>App content</Text>;
    const boundary = native.ChatKeyboardProvider({ children: child });
    expect(boundary.props.children).toBe(child);
    expect(boundary.type).toBe(platform === 'ios' ? controller.KeyboardProvider : React.Fragment);
    if (platform === 'ios') {
      expect(boundary.props).toMatchObject({ preload: false, statusBarTranslucent: true, navigationBarTranslucent: true, preserveEdgeToEdge: true });
    } else {
      expect(Object.keys(boundary.props)).toEqual(['children']);
    }
  });
});

it('keeps the web wrapper on RN and leaves the web history/composer unshifted', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const web = require('../ChatKeyboard.tsx');
  expect(web.ChatKeyboardAvoidingView).toBe(require('react-native').KeyboardAvoidingView);
  act(() => { tree = create(<web.IOSKeyboardViewport inset={320} testID="web-history" style={{ flex: 1 }}><Text>History</Text></web.IOSKeyboardViewport>); });
  const view = tree!.root.findAllByType(View).find(node => node.props.testID === 'web-history')!;
  expect(StyleSheet.flatten(view.props.style)).toEqual({ flex: 1 });
  expect(view.props.inset).toBeUndefined();
  expect(subscriptions).toHaveLength(0);
});
