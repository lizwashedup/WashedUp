import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, ScrollView, TouchableOpacity, StyleSheet, Dimensions, Text, View } from 'react-native';
import DatePickerSheet from '../DatePickerSheet';
import WashedUpCalendar from '../../calendar/WashedUpCalendar';
import { AfterglowFonts } from '../../../constants/Typography';
import Colors from '../../../constants/Colors';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSelection: jest.fn() }));
let tree: ReactTestRenderer;
const select = jest.fn(), cancel = jest.fn();
const day = { year: 2040, month: 7, day: 2 };
const control = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
beforeEach(async () => {
  select.mockReset(); cancel.mockReset();
  await act(async () => { tree = create(<DatePickerSheet selected={day} onCancel={cancel} onSelect={select} />); });
});
afterEach(() => act(() => tree.unmount()));

it('keeps calendar navigation individually accessible within the existing modal', () => {
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  expect(tree.root.findAll(node => node.props.accessibilityViewIsModal)[0].props.accessible).toBe(false);
  expect(tree.root.findByType(ScrollView).findByType(WashedUpCalendar)).toBeDefined();
  expect(tree.root.findByType(ScrollView).findAllByType(TouchableOpacity)).toHaveLength(0);
  expect(control('August 2, 2040').props.accessibilityState.selected).toBe(true);
  act(() => control('next month').props.onPress());
  expect(control('Choose month, currently September 2040')).toBeDefined();
  expect(select).not.toHaveBeenCalled();
});

it.each(['button', 'backdrop', 'escape'])('cancels through %s without choosing a date or accepting a late tap', route => {
  const lateSelect = tree.root.findByType(WashedUpCalendar).props.onSelect;
  if (route === 'button') act(() => control('Cancel date changes').props.onPress());
  if (route === 'backdrop') act(() => tree.root.findAll(node => typeof node.props.onPress === 'function' && StyleSheet.flatten(node.props.style)?.justifyContent === 'flex-end')[0].props.onPress());
  if (route === 'escape') act(() => tree.root.findAll(node => typeof node.props.onAccessibilityEscape === 'function')[0].props.onAccessibilityEscape());
  act(() => lateSelect({ ...day, day: 3 }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});

it('accepts one explicit day and ignores duplicate or delayed selections', () => {
  const callback = tree.root.findByType(WashedUpCalendar).props.onSelect;
  act(() => { callback({ ...day, day: 3 }); callback({ ...day, day: 4 }); });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith({ ...day, day: 3 });
  expect(cancel).not.toHaveBeenCalled();
});

it('retires callbacks when the containing editor closes', () => {
  const callback = tree.root.findByType(WashedUpCalendar).props.onSelect;
  act(() => tree.unmount());
  act(() => callback({ ...day, day: 3 }));
  expect(select).not.toHaveBeenCalled();
});

it('retains the calendar past-date restriction', () => {
  act(() => tree.update(<DatePickerSheet selected={{ year: 2000, month: 0, day: 1 }} onCancel={cancel} onSelect={select} />));
  // Remount because the calendar intentionally keeps the browsed month during a visit.
  act(() => tree.update(<DatePickerSheet key="past" selected={{ year: 2000, month: 0, day: 1 }} onCancel={cancel} onSelect={select} />));
  expect(control('January 1, 2000').props.disabled).toBe(true);
});


it('preserves the viewed month and date semantics when switching to large text', () => {
  const original = Dimensions.get('window');
  try {
    act(() => control('next month').props.onPress());
    act(() => Dimensions.set({ window: { ...original, width: 375, height: 667, fontScale: 3.1 } }));
    expect(control('Choose month, currently September 2040')).toBeDefined();
    expect(control('September 2, 2040').findAllByType(Text).some(node => node.props.children.join?.('') === 'Sun, 2')).toBe(true);
    act(() => control('Choose month, currently September 2040').props.onPress());
    act(() => control('December 2040').props.onPress());
    expect(control('Choose month, currently December 2040')).toBeDefined();
    act(() => control('December 12, 2040').props.onPress());
    expect(select).toHaveBeenCalledWith({ year: 2040, month: 11, day: 12 });
  } finally { act(() => Dimensions.set({ window: original })); }
});


it.each([undefined, { fonts: AfterglowFonts }])('preserves filter markers and selected-day semantics at large text (%p)', appearance => {
  const original = Dimensions.get('window');
  try {
    act(() => Dimensions.set({ window: { ...original, fontScale: 3.1 } }));
    act(() => tree.update(<WashedUpCalendar appearance={appearance} mode="filter" selected={day}
      markedDays={new Set(['2040-7-2', '2040-7-3'])} onSelect={select} />));
    const selectedDay = control('August 2, 2040');
    expect(selectedDay.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(selectedDay.findAllByType(Text).some(node => node.props.children === '✓')).toBe(true);
    const markedDay = control('August 3, 2040');
    expect(markedDay.findAllByType(View).some(node => StyleSheet.flatten(node.props.style)?.backgroundColor === Colors.gold)).toBe(true);
    act(() => markedDay.props.onPress());
    expect(select).toHaveBeenCalledWith({ year: 2040, month: 7, day: 3 });
  } finally { act(() => Dimensions.set({ window: original })); }
});
