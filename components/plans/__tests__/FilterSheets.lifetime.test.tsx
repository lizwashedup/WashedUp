import React from 'react';
import { Animated, Modal, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FilterBottomSheet } from '../../FilterBottomSheet';
import { WhenCalendarSheet } from '../WhenCalendarSheet';
import WashedUpCalendar from '../../calendar/WashedUpCalendar';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowFonts } from '../../../constants/Typography';
import { hapticSelection } from '../../../lib/haptics';

let mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 16, left: 0, right: 0 }) }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('lucide-react-native', () => ({ Check: () => null }));
jest.mock('../../calendar/WashedUpCalendar', () => ({ __esModule: true, default: () => null }));

type Motion = { start: jest.Mock; stop: jest.Mock; callback?: (result: { finished: boolean }) => void };
const motions: Motion[] = [];
const pans: any[] = [];
const cleanup: Array<() => void> = [];
function animation() {
  const value: Motion = { start: jest.fn(callback => { value.callback = callback; }), stop: jest.fn() };
  motions.push(value);
  return value as unknown as Animated.CompositeAnimation;
}
const appearance = { fonts: AfterglowFonts };
const day = { year: 2040, month: 8, day: 15 };
type Kind = 'category' | 'when';
function mount(kind: Kind, extra: Record<string, unknown> = {}) {
  const callbacks = { onClose: jest.fn(), onClear: jest.fn(), onToggle: jest.fn(), onToggleWhen: jest.fn(), onSelectDay: jest.fn() };
  let props: any = {
    visible: true, title: 'Category', options: [{ key: 'outdoors', label: 'Outdoors' }], selected: ['outdoors'],
    whenSelected: ['tonight'], daySelected: day, markedDays: new Set(['2040-09-15']), ...callbacks, ...extra,
  };
  const element = () => kind === 'category' ? <FilterBottomSheet {...props} /> : <WhenCalendarSheet {...props} />;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(element()); });
  let removed = false;
  const unmount = () => { if (!removed) act(() => tree.unmount()); removed = true; };
  cleanup.push(unmount);
  const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(text => text.props.children === label))!;
  const update = (next: Record<string, unknown> = {}) => { props = { ...props, ...next }; act(() => tree.update(element())); };
  const selection = () => button(kind === 'category' ? 'Outdoors' : 'Tonight');
  return {
    tree, callbacks, update, unmount, button, selection,
    modal: () => tree.root.findByType(Modal),
    sheet: () => tree.root.findAll(node => node.props.accessibilityViewIsModal === true)[0],
    calendar: () => tree.root.findByType(WashedUpCalendar),
  };
}
beforeEach(() => {
  mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 };
  motions.length = 0; pans.length = 0;
  jest.spyOn(Animated, 'parallel').mockImplementation(animation);
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(Animated, 'spring').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    pans.push(config);
    return { panHandlers: { onResponderRelease: config.onPanResponderRelease } } as any;
  });
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); jest.clearAllMocks(); });

describe.each<Kind>(['category', 'when'])('%s filter visit', kind => {
  it('does not animate while hidden', () => {
    const f = mount(kind, { visible: false });
    expect(motions).toHaveLength(0); expect(f.tree.root.findAllByType(Modal)).toHaveLength(0);
  });
  it('drag uses the latest close callback within the current visit', () => {
    const f = mount(kind), current = jest.fn();
    f.update({ onClose: current });
    act(() => pans[0].onPanResponderRelease({}, { dy: 100, vy: 0 }));
    act(() => motions.at(-1)!.callback!({ finished: true }));
    expect(current).toHaveBeenCalledTimes(1); expect(f.callbacks.onClose).not.toHaveBeenCalled();
  });
  it('locks dismissal and prevents filter changes while closing', () => {
    const f = mount(kind);
    const select = f.selection().props.onPress, clear = f.button('Clear all').props.onPress;
    const selectDay = kind === 'when' ? f.calendar().props.onSelect : undefined;
    act(() => {
      f.modal().props.onRequestClose(); f.button('Done').props.onPress();
      select(); clear(); selectDay?.(day);
    });
    expect(motions).toHaveLength(2);
    expect(f.callbacks.onClear).not.toHaveBeenCalled();
    expect(f.callbacks.onToggle).not.toHaveBeenCalled(); expect(f.callbacks.onToggleWhen).not.toHaveBeenCalled();
    expect(f.callbacks.onSelectDay).not.toHaveBeenCalled(); expect(hapticSelection).not.toHaveBeenCalled();
    act(() => { motions[1].callback!({ finished: true }); motions[1].callback!({ finished: true }); });
    expect(f.callbacks.onClose).toHaveBeenCalledTimes(1);
  });
  it('an interrupted animation does not close and restores usable filters', () => {
    const f = mount(kind);
    act(() => f.modal().props.onRequestClose());
    act(() => motions[1].callback!({ finished: false }));
    expect(f.callbacks.onClose).not.toHaveBeenCalled();
    act(() => { f.selection().props.onPress(); f.button('Clear all').props.onPress(); });
    expect(kind === 'category' ? f.callbacks.onToggle : f.callbacks.onToggleWhen).toHaveBeenCalledTimes(1);
    expect(f.callbacks.onClear).toHaveBeenCalledTimes(1);
  });
  it('old animation, drag and selection callbacks cannot touch a reopened visit', () => {
    const f = mount(kind);
    const oldPan = pans[0], select = f.selection().props.onPress, clear = f.button('Clear all').props.onPress;
    const selectDay = kind === 'when' ? f.calendar().props.onSelect : undefined;
    act(() => f.modal().props.onRequestClose());
    const oldMotion = motions[1];
    f.update({ visible: false }); f.update({ visible: true });
    const currentMotionCount = motions.length;
    act(() => {
      oldMotion.callback!({ finished: true }); oldPan.onPanResponderRelease({}, { dy: 100, vy: 0 });
      select(); clear(); selectDay?.(day);
    });
    expect(motions).toHaveLength(currentMotionCount); expect(oldMotion.stop).toHaveBeenCalled();
    Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
    act(() => f.selection().props.onPress());
    expect(kind === 'category' ? f.callbacks.onToggle : f.callbacks.onToggleWhen).toHaveBeenCalledTimes(1);
  });
  it('does not close or change filters after unmount', () => {
    const f = mount(kind), select = f.selection().props.onPress;
    act(() => f.modal().props.onRequestClose()); const pending = motions[1]; f.unmount();
    act(() => { pending.callback!({ finished: true }); select(); });
    Object.values(f.callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });
  it('uses the current screen height, and rotation retires an old dismissal', () => {
    const f = mount(kind);
    act(() => f.modal().props.onRequestClose()); const oldMotion = motions[1];
    mockWindow = { ...mockWindow, height: 500 }; f.update();
    act(() => oldMotion.callback!({ finished: true }));
    expect(f.callbacks.onClose).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(f.sheet().props.style).maxHeight).toBe(468);
    act(() => f.modal().props.onRequestClose());
    expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 500 }));
  });
  it('keeps downward dismissal on the grabber and scrolling on the content', () => {
    const f = mount(kind, { appearance });
    const draggable = f.tree.root.findAll(node => node.props.onResponderRelease === pans[0].onPanResponderRelease);
    expect(draggable.length).toBeGreaterThan(0);
    expect(draggable.every(node => node.props.testID === `${kind}-filter-grabber`)).toBe(true);
    const scroll = f.tree.root.findAllByType(ScrollView).find(node => !node.props.horizontal)!;
    expect(scroll).toBeDefined(); expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(pans[0].onMoveShouldSetPanResponder({}, { dx: 2, dy: 10 })).toBe(true);
    expect(pans[0].onMoveShouldSetPanResponder({}, { dx: 20, dy: 10 })).toBe(false);
    expect(pans[0].onMoveShouldSetPanResponder({}, { dx: 0, dy: -20 })).toBe(false);
  });
  it('retains default palette and opts into readable type, 44pt actions and selection state', () => {
    const f = mount(kind);
    expect(StyleSheet.flatten(f.sheet().props.style).backgroundColor).toBe(Colors.white);
    f.update({ appearance });
    expect(StyleSheet.flatten(f.sheet().props.style)).toMatchObject({ backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 8 });
    expect(StyleSheet.flatten(f.button('Done').props.style)).toMatchObject({ minHeight: 48, borderRadius: 4 });
    expect(StyleSheet.flatten(f.button('Clear all').props.style).minHeight).toBe(44);
    const text = f.selection().findAllByType(Text)[0];
    expect(StyleSheet.flatten(text.props.style).fontFamily).toBe(AfterglowFonts.semibold);
    expect(f.selection().props.accessibilityRole).toBe('checkbox'); expect(f.selection().props.accessibilityState.checked).toBe(true);
    act(() => f.selection().props.onPress());
    expect(kind === 'category' ? f.callbacks.onToggle : f.callbacks.onToggleWhen).toHaveBeenCalledWith(kind === 'category' ? 'outdoors' : 'tonight');
  });
});

it('passes the exact existing calendar data, filter mode, appearance and day callback', () => {
  const f = mount('when', { appearance });
  expect(f.calendar().props).toMatchObject({ mode: 'filter', selected: day, appearance });
  expect(f.calendar().props.markedDays).toEqual(new Set(['2040-09-15']));
  act(() => f.calendar().props.onSelect(day)); expect(f.callbacks.onSelectDay).toHaveBeenCalledWith(day);
  expect(f.callbacks.onToggleWhen).not.toHaveBeenCalled(); expect(f.callbacks.onClear).not.toHaveBeenCalled();
});
