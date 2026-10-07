import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard, Modal, StyleSheet, Text, TextInput } from 'react-native';
import TimePicker from '../TimePicker';
import { hapticLight } from '../../../lib/haptics';
import { AfterglowFonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));

let tree: ReactTestRenderer;
let props: React.ComponentProps<typeof TimePicker>;

const modal = () => tree.root.findByType(Modal).props;
const byLabel = (label: string) => tree.root.findAll(
  node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
)[0];
const field = (label: string) => tree.root.findAllByType(TextInput).find(
  node => node.props.accessibilityLabel.startsWith(label),
)!;
const trigger = () => tree.root.findAll(
  node => typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(text => String(text.props.children).toLowerCase() === 'change'),
)[0];
const confirm = () => tree.root.findAll(
  node => typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(text => String(text.props.children).toLowerCase() === 'set time'),
).pop()!;

function open() {
  act(() => trigger().props.onPress());
}

async function mount() {
  await act(async () => { tree = create(<TimePicker {...props} />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  props = { hour: 7, minute: '00', period: 'PM', selected: true, onChange: jest.fn() };
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});

afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

it('announces the selected time and expanded state, or a time that is not set', async () => {
  await mount();
  expect(trigger().props).toMatchObject({
    accessibilityRole: 'button',
    accessibilityLabel: 'Time, 7:00 PM',
    accessibilityState: { expanded: false },
  });
  open();
  expect(trigger().props.accessibilityState.expanded).toBe(true);

  act(() => modal().onRequestClose());
  props.selected = false;
  act(() => tree.update(<TimePicker {...props} />));
  expect(trigger().props.accessibilityLabel).toBe('Time, not set');
});

it('offers an explicit Cancel with a 44-point target and never commits invalid edits', async () => {
  await mount();
  open();
  act(() => {
    field('Hour').props.onChangeText('99');
    field('Minute').props.onChangeText('88');
  });
  expect(confirm().props.disabled).toBe(true);

  const cancel = byLabel('Cancel time changes');
  expect(cancel).toBeDefined();
  expect(StyleSheet.flatten(cancel.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
  act(() => cancel.props.onPress());
  expect(modal().visible).toBe(false);
  expect(props.onChange).not.toHaveBeenCalled();
  expect(Keyboard.dismiss).toHaveBeenCalled();

  open();
  expect(field('Hour').props.value).toBe('7');
  expect(field('Minute').props.value).toBe('00');
  expect(byLabel('PM').props.accessibilityState.selected).toBe(true);
});

it.each(['back', 'backdrop', 'accessibility-escape'] as const)(
  'discards a valid unconfirmed time through %s',
  async route => {
    await mount();
    open();
    act(() => {
      field('Hour').props.onChangeText('10');
      byLabel('AM').props.onPress();
    });

    if (route === 'back') act(() => modal().onRequestClose());
    if (route === 'backdrop') {
      const backdrop = tree.root.findAll(
        node => typeof node.props.onPress === 'function' &&
          StyleSheet.flatten(node.props.style)?.justifyContent === 'flex-end',
      )[0];
      act(() => backdrop.props.onPress());
    }
    if (route === 'accessibility-escape') {
      const sheet = tree.root.findAll(
        node => typeof node.props.onAccessibilityEscape === 'function',
      )[0];
      act(() => sheet.props.onAccessibilityEscape());
    }

    expect(modal().visible).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
    open();
    expect(field('Hour').props.value).toBe('7');
    expect(byLabel('PM').props.accessibilityState.selected).toBe(true);
  },
);

it('keeps direct entry normalization, AM/PM and quarter-hour shortcuts unchanged', async () => {
  await mount();
  open();
  act(() => {
    field('Hour').props.onChangeText('2');
    field('Minute').props.onChangeText('5');
    byLabel('AM').props.onPress();
  });
  act(() => confirm().props.onPress());
  expect(props.onChange).toHaveBeenCalledWith(2, '05', 'AM');
  expect(hapticLight).toHaveBeenCalledTimes(1);

  open();
  act(() => byLabel('45 minutes').props.onPress());
  act(() => confirm().props.onPress());
  expect(props.onChange).toHaveBeenLastCalledWith(7, '45', 'PM');
});

it('leaves validation intact and rejects invalid confirmation callbacks', async () => {
  await mount();
  open();
  act(() => {
    field('Hour').props.onChangeText('0');
    field('Minute').props.onChangeText('99');
  });
  act(() => confirm().props.onPress());
  expect(props.onChange).not.toHaveBeenCalled();
  expect(modal().visible).toBe(true);
});

it('keeps form controls individually accessible inside the modal', async () => {
  await mount();
  open();
  const sheet = tree.root.findAll(node => node.props.accessibilityViewIsModal === true)[0];
  expect(sheet.props.accessible).toBe(false);
  expect(typeof sheet.props.onAccessibilityEscape).toBe('function');
  expect(field('Hour').props.accessibilityLabel).toBe('Hour, 1 through 12');
  expect(field('Minute').props.accessibilityLabel).toBe('Minute, 0 through 59');
});

it('does not commit a confirmation retained before cancel, or let an old cancel close a reopened visit', async () => {
  await mount();
  open();
  const oldConfirm = confirm().props.onPress;
  const oldCancel = byLabel('Cancel time changes').props.onPress;
  act(() => oldCancel());
  act(() => oldConfirm());
  expect(props.onChange).not.toHaveBeenCalled();

  open();
  act(() => oldCancel());
  expect(modal().visible).toBe(true);
  act(() => confirm().props.onPress());
  expect(props.onChange).toHaveBeenCalledTimes(1);
});


it('styles the existing staged time controls with the reviewed fonts and full touch targets', async()=>{
 props.appearance={fonts:AfterglowFonts};await mount();open();
 expect(StyleSheet.flatten(trigger().props.style)).toMatchObject({minHeight:52,borderRadius:6,backgroundColor:AfterglowColors.white});
 expect(StyleSheet.flatten(field('Hour').props.style)).toMatchObject({minHeight:56,fontFamily:AfterglowFonts.semibold});
 for(const label of ['AM','PM','00 minutes','15 minutes','30 minutes','45 minutes']) {
  expect(StyleSheet.flatten(byLabel(label).props.style).minHeight).toBeGreaterThanOrEqual(44);
 }
 expect(StyleSheet.flatten(confirm().props.style)).toMatchObject({minHeight:48,backgroundColor:AfterglowColors.clay});
 expect(tree.root.findAllByType(Text).some(n=>n.props.children==='Los Angeles time · adjusts for daylight saving')).toBe(true);
});

it('preserves staged arbitrary-minute entry, normalization and cancel without committing', async()=>{
 props.appearance={fonts:AfterglowFonts};await mount();open();
 act(()=>{field('Hour').props.onChangeText('11');field('Minute').props.onChangeText('37');byLabel('AM').props.onPress();});
 act(()=>confirm().props.onPress());expect(props.onChange).toHaveBeenLastCalledWith(11,'37','AM');
 open();act(()=>{field('Hour').props.onChangeText('9');byLabel('Cancel time changes').props.onPress();});
 expect(props.onChange).toHaveBeenCalledTimes(1);expect(modal().visible).toBe(false);
});

it('keeps invalid staged input visible and prevents duplicate confirmation', async()=>{
 props.appearance={fonts:AfterglowFonts};await mount();open();
 act(()=>field('Minute').props.onChangeText('99'));
 act(()=>confirm().props.onPress());expect(props.onChange).not.toHaveBeenCalled();
 expect(tree.root.findAllByType(Text).some(n=>n.props.children==='Enter an hour from 1–12 and minutes from 00–59.')).toBe(true);
 act(()=>field('Minute').props.onChangeText('8'));
 const submit=confirm().props.onPress;act(()=>{submit();submit();});
 expect(props.onChange).toHaveBeenCalledTimes(1);expect(props.onChange).toHaveBeenCalledWith(7,'08','PM');
});
