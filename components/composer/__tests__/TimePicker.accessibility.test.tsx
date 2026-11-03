import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, FlatList, Keyboard, Modal, StyleSheet, TextInput } from 'react-native';
import TimePicker from '../TimePicker';
import TimePickerSheet, { timeChoices, type PickerTime } from '../TimePickerSheet';
import { AfterglowFonts } from '../../../constants/Typography';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
let tree: ReactTestRenderer;
let props: React.ComponentProps<typeof TimePicker>;
const modal = () => tree.root.findByType(Modal).props;
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const field = (label: string) => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel.startsWith(label))!;
const trigger = () => tree.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Time,') && typeof node.props.onPress === 'function')[0];
const done = () => button('Done, confirm time');
const exact = () => act(() => button('Enter exact time').props.onPress());
const open = () => act(() => trigger().props.onPress());
const row = (time: PickerTime) => tree.root.findByType(FlatList).props.renderItem({ item: time });
async function mount() { await act(async () => { tree = create(<TimePicker {...props} />); }); }
beforeEach(() => {
  props = { hour: 7, minute: '00', period: 'PM', selected: true, onChange: jest.fn() };
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });

it('opens a keyboard-free list at the selected time and announces expanded state', async () => {
  await mount(); open();
  expect(trigger().props.accessibilityState.expanded).toBe(true);
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  const list = tree.root.findByType(FlatList).props;
  expect(list.data).toHaveLength(96);
  expect(list.data[list.initialScrollIndex]).toEqual({ hour: 7, minute: '00', period: 'PM' });
  expect(row({ hour: 7, minute: '00', period: 'PM' }).props.accessibilityState.selected).toBe(true);
  expect(props.onChange).not.toHaveBeenCalled();
});

it('selects a complete time but commits only on Done, once', async () => {
  await mount(); open();
  act(() => row({ hour: 8, minute: '15', period: 'PM' }).props.onPress());
  expect(row({ hour: 8, minute: '15', period: 'PM' }).props.accessibilityState.selected).toBe(true);
  expect(props.onChange).not.toHaveBeenCalled();
  const submit = done().props.onPress;
  act(() => { submit(); submit(); });
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(props.onChange).toHaveBeenCalledWith(8, '15', 'PM');
  expect(modal().visible).toBe(false);
});

it.each(['button', 'back', 'backdrop', 'escape'])('discards a list selection through %s and resets on reopening', async route => {
  await mount(); open();
  act(() => row({ hour: 10, minute: '30', period: 'AM' }).props.onPress());
  if (route === 'button') act(() => button('Cancel time changes').props.onPress());
  if (route === 'back') act(() => modal().onRequestClose());
  if (route === 'backdrop') act(() => tree.root.findAll(node => typeof node.props.onPress === 'function' && StyleSheet.flatten(node.props.style)?.justifyContent === 'flex-end')[0].props.onPress());
  if (route === 'escape') act(() => tree.root.findAll(node => typeof node.props.onAccessibilityEscape === 'function')[0].props.onAccessibilityEscape());
  expect(props.onChange).not.toHaveBeenCalled();
  expect(modal().visible).toBe(false);
  open();
  expect(row({ hour: 7, minute: '00', period: 'PM' }).props.accessibilityState.selected).toBe(true);
});

it('keeps arbitrary stored minutes as a selected list option and on no-op confirmation', async () => {
  props.minute = '37'; await mount(); open();
  expect(tree.root.findByType(FlatList).props.data).toHaveLength(97);
  expect(row({ hour: 7, minute: '37', period: 'PM' }).props.accessibilityState.selected).toBe(true);
  act(() => done().props.onPress());
  expect(props.onChange).toHaveBeenCalledWith(7, '37', 'PM');
});

it.each([false, true])('supports precise entry and normalization (staged: %s)', async staged => {
  if (staged) props.appearance = { fonts: AfterglowFonts };
  await mount(); open(); exact();
  act(() => { field('Hour').props.onChangeText('2'); field('Minute').props.onChangeText('5'); button('AM').props.onPress(); });
  act(() => done().props.onPress());
  expect(props.onChange).toHaveBeenCalledWith(2, '05', 'AM');
});

it.each([['0', '00'], ['13', '00'], ['8', '60'], ['8', ''], ['', '00']])('rejects invalid exact time %s:%s', async (hour, minute) => {
  await mount(); open(); exact();
  act(() => { field('Hour').props.onChangeText(hour); field('Minute').props.onChangeText(minute); });
  expect(done().props.disabled).toBe(true);
  act(() => done().props.onPress());
  expect(props.onChange).not.toHaveBeenCalled();
  expect(modal().visible).toBe(true);
});

it('discards exact entry on cancel and ignores callbacks from the retired visit', async () => {
  await mount(); open(); exact();
  act(() => field('Minute').props.onChangeText('37'));
  const oldDone = done().props.onPress;
  const oldCancel = button('Cancel time changes').props.onPress;
  act(() => oldCancel()); open();
  act(() => { oldDone(); oldCancel(); });
  expect(props.onChange).not.toHaveBeenCalled();
  expect(modal().visible).toBe(true);
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

it('preserves exact edits while changing text size and keeps fixed actions outside the scrolling body', async () => {
  const original = Dimensions.get('window');
  await mount(); open(); exact();
  act(() => field('Minute').props.onChangeText('37'));
  try {
    act(() => Dimensions.set({ window: { ...original, width: 375, height: 667, fontScale: 3.1 } }));
    expect(field('Minute').props.value).toBe('37');
    expect(StyleSheet.flatten(button('Cancel time changes').props.style).minHeight).toBeGreaterThanOrEqual(44);
    act(() => done().props.onPress());
    expect(props.onChange).toHaveBeenCalledWith(7, '37', 'PM');
  } finally { act(() => Dimensions.set({ window: original })); }
});

it('does not commit after the sheet is unmounted by its containing editor', async () => {
  const confirm = jest.fn(), cancel = jest.fn();
  await act(async () => { tree = create(<TimePickerSheet embedded initial={{ hour: 7, minute: '37', period: 'PM' }} onCancel={cancel} onConfirm={confirm} />); });
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  const lateDone = done().props.onPress, lateCancel = button('Cancel time changes').props.onPress;
  act(() => tree.unmount());
  act(() => { lateDone(); lateCancel(); });
  expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});

it('orders midnight, noon and the end of the day correctly without duplicating quarter hours', () => {
  const choices = timeChoices({ hour: 12, minute: '00', period: 'AM' });
  expect(choices).toHaveLength(96);
  expect(choices[0]).toEqual({ hour: 12, minute: '00', period: 'AM' });
  expect(choices[48]).toEqual({ hour: 12, minute: '00', period: 'PM' });
  expect(choices[95]).toEqual({ hour: 11, minute: '45', period: 'PM' });
});


it('shows a custom edit as a selected option when returning to the list', async () => {
  await mount(); open(); exact();
  act(() => field('Minute').props.onChangeText('37'));
  const back = tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAllByType(require('react-native').Text).some(text => text.props.children === 'Choose from list')).pop()!;
  act(() => back.props.onPress());
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(tree.root.findByType(FlatList).props.data).toContainEqual({hour:7,minute:'37',period:'PM'});
  expect(row({hour:7,minute:'37',period:'PM'}).props.accessibilityState.selected).toBe(true);
  act(() => done().props.onPress());
  expect(props.onChange).toHaveBeenCalledWith(7,'37','PM');
});

// UIKit can finish dismissing after visible becomes false. Keep its content
// attached until the next visit instead of tearing it out mid-transition.
it('retains content during native dismissal and starts a fresh next visit', async () => {
  await mount(); open(); exact();
  act(() => field('Minute').props.onChangeText('37'));
  act(() => done().props.onPress());
  expect(modal().visible).toBe(false);
  expect(tree.root.findAllByType(TimePickerSheet)).toHaveLength(1);
  expect(field('Minute').props.value).toBe('37');
  open();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(row({hour:7,minute:'00',period:'PM'}).props.accessibilityState.selected).toBe(true);
});
