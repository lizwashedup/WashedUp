import React from 'react';
const ReactNative = require('react-native') as typeof import('react-native');
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BrandedAlert } from '../BrandedAlert';

let tree: ReactTestRenderer;
const onClose = jest.fn(), onCopy = jest.fn();
const buttons = [{ text: 'Copy message', onPress: onCopy }, { text: 'Keep editing', style: 'cancel' as const }];
const longMessage = `Your current edit is unchanged. Earlier message:\n\n${'A message with details. '.repeat(100)}`;
const windowSize = { width: 375, height: 667, scale: 2, fontScale: 1 };
const row = () => tree.root.findAllByType(View).find(node => {
  const style = StyleSheet.flatten(node.props.style);
  return style?.gap === 10 && style?.width === '100%' && style?.justifyContent === 'center';
})!;
const containers = () => {
  // NativeWind wraps Pressable, so inspect the rendered touch-handler nodes.
  const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function');
  return [
    pressables.find(node => StyleSheet.flatten(node.props.style)?.flex === 1 && StyleSheet.flatten(node.props.style)?.paddingHorizontal === 32)!,
    pressables.find(node => StyleSheet.flatten(node.props.style)?.maxWidth === 340)!,
  ];
};
async function mount(props: Partial<React.ComponentProps<typeof BrandedAlert>> = {}) {
  await act(async () => { tree = create(<BrandedAlert visible title="Earlier message did not send" message="Short message" buttons={buttons} onClose={onClose} {...props} />); });
}
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue(windowSize); });
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });

it('keeps the default message and two-action layout without adding a scroll region', async () => {
  await mount();
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  const message = tree.root.findAllByType(Text).find(node => node.props.children === 'Short message')!;
  expect(message.props.selectable).toBeUndefined();
  expect(StyleSheet.flatten(message.props.style)).toMatchObject({ textAlign: 'center', marginBottom: 20 });
  expect(StyleSheet.flatten(row().props.style).flexDirection).toBe('row');
  act(() => tree.root.findAllByType(TouchableOpacity)[0].props.onPress());
  expect(onCopy).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps all long message text selectable inside a bounded body with title and actions outside it', async () => {
  await mount({ message: longMessage, scrollMessage: true });
  const body = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ maxHeight: windowSize.height * 0.45, flexShrink: 1, minHeight: 0 });
  expect(body.props.showsVerticalScrollIndicator).toBe(true);
  expect(body.findAllByType(TouchableOpacity)).toHaveLength(0);
  const text = body.findByType(Text);
  expect(text.props.children).toBe(longMessage); expect(text.props.selectable).toBe(true);
  expect(text.props.numberOfLines).toBeUndefined(); expect(text.props.maxFontSizeMultiplier).toBeUndefined();
  const heading = tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'header')!;
  expect(heading.props.children).toBe('Earlier message did not send');
  expect(body.findAll(node => node === heading)).toHaveLength(0);
  const card = tree.root.findAllByProps({ accessibilityViewIsModal: true })[0];
  expect(StyleSheet.flatten(card.props.style).maxHeight).toBe(windowSize.height - 48);
});

it('stacks large-text actions and leaves a shrinking body on a small screen', async () => {
  jest.mocked(ReactNative.useWindowDimensions).mockReturnValue({ width: 320, height: 480, scale: 2, fontScale: 2 });
  await mount({ message: longMessage, scrollMessage: true });
  expect(StyleSheet.flatten(row().props.style)).toMatchObject({ flexDirection: 'column', flexShrink: 0 });
  expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.style).maxHeight).toBe(216);
  for (const button of tree.root.findAllByType(TouchableOpacity)) {
    expect(button.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minHeight: 44, flex: 0 });
  }
  act(() => tree.root.findByType(Modal).props.onRequestClose()); expect(onClose).toHaveBeenCalledTimes(1);
});

it('does not render an empty scroll body when no message is supplied', async () => {
  await mount({ message: undefined, scrollMessage: true });
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(2);
});

it('opts into token-based compact confirmation styling while preserving action order and close timing', async () => {
  const { AfterglowFallbackFonts } = require('../../constants/Typography');
  const { AfterglowColors } = require('../../constants/Colors');
  const order: string[] = [];
  await mount({ appearance: { fonts: AfterglowFallbackFonts }, buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => order.push('remove') }], onClose: () => order.push('close') });
  const actions = tree.root.findAllByType(TouchableOpacity);
  expect(actions.map(action => action.findByType(Text).props.children)).toEqual(['Cancel', 'Remove']);
  for (const action of actions) expect(StyleSheet.flatten(action.props.style)).toMatchObject({ borderRadius: 4, minHeight: 44 });
  const title = tree.root.findAllByType(Text).find(node => node.props.children === 'Earlier message did not send')!;
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontFamily: AfterglowFallbackFonts.semibold, color: AfterglowColors.ink });
  act(() => actions[1].props.onPress()); expect(order).toEqual(['remove', 'close']);
});

it('retains bounded selectable scrolling and fixed large-text actions with optional appearance', async () => {
  const { AfterglowFallbackFonts } = require('../../constants/Typography');
  jest.mocked(ReactNative.useWindowDimensions).mockReturnValue({ width: 320, height: 480, scale: 2, fontScale: 2 });
  await mount({ appearance: { fonts: AfterglowFallbackFonts }, scrollMessage: true, message: longMessage });
  const body = tree.root.findByType(ScrollView);
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ maxHeight: 216, flexShrink: 1 });
  expect(body.findByType(Text).props.selectable).toBe(true); expect(body.findAllByType(TouchableOpacity)).toHaveLength(0);
  expect(StyleSheet.flatten(row().props.style)).toMatchObject({ flexDirection: 'column', flexShrink: 0 });
});


describe('individually accessible confirmation actions', () => {
  it.each(['default', 'compact', 'creator', 'scrolling'] as const)(
    'exposes Cancel and Log out individually in the %s modal without grouping them into the backdrop or card',
    async (variant) => {
      const { AfterglowFallbackFonts } = require('../../constants/Typography');
      await mount({
        title: 'Log out', message: 'Are you sure you want to log out?',
        buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: onCopy }],
        scrollMessage: variant === 'scrolling',
        appearance: variant === 'compact' ? { fonts: AfterglowFallbackFonts }
          : variant === 'creator' ? { fonts: AfterglowFallbackFonts, variant: 'creator' } : undefined,
      });
      const [backdrop, card] = containers();
      for (const container of [backdrop, card]) {
        expect(container.props.accessible).toBe(false);
        expect(container.props.focusable).toBe(false);
        expect(container.props.accessibilityElementsHidden).not.toBe(true);
        expect(container.props.importantForAccessibility).not.toBe('no-hide-descendants');
      }
      expect(card.props.accessibilityViewIsModal).toBe(true);
      const actions = card.findAllByType(TouchableOpacity);
      expect(actions.map(action => action.props.accessibilityLabel)).toEqual(['Cancel', 'Log out']);
      for (const action of actions) {
        expect(action.props.accessible).toBe(true);
        expect(action.props.accessibilityRole).toBe('button');
      }
      const heading = card.findAllByType(Text).find(node => node.props.accessibilityRole === 'header')!;
      expect(heading.props.children).toBe('Log out');
      act(() => actions[0].props.onPress());
      expect(onCopy).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1);
      onClose.mockClear();
      act(() => actions[1].props.onPress());
      expect(onCopy).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps card touches from closing the modal while a backdrop tap dismisses without running an action', async () => {
    await mount();
    const [backdrop, card] = containers();
    const stopPropagation = jest.fn();
    act(() => card.props.onPress({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); expect(onCopy).not.toHaveBeenCalled();
    act(() => backdrop.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1); expect(onCopy).not.toHaveBeenCalled();
  });

  it('supports accessibility escape and system dismissal without running an action or claiming dismissal before the modal closes', async () => {
    const onDismiss = jest.fn();
    await mount({ onDismiss });
    const card = containers()[1];
    act(() => card.props.onAccessibilityEscape());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled(); expect(onDismiss).not.toHaveBeenCalled();
    onClose.mockClear();
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled(); expect(onDismiss).not.toHaveBeenCalled();
    act(() => tree.root.findByType(Modal).props.onDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it.each([false, true])('remeasures mounted alert text while preserving modal, content and exact recovery actions (scrollMessage=%s)', async scrollMessage => {
  let currentScale = 1;
  const subscribers = new Set<(scale: number) => void>();
  jest.mocked(ReactNative.useWindowDimensions).mockImplementation(() => {
    const [fontScale, setScale] = React.useState(currentScale);
    React.useEffect(() => { subscribers.add(setScale); return () => { subscribers.delete(setScale); }; }, []);
    return { ...windowSize, fontScale };
  });
  const retry = jest.fn(), closeAction = jest.fn(), dismissed = jest.fn();
  const title = 'Reaction not confirmed';
  const message = 'We could not confirm your reaction. Retry will check it before making another change.';
  await mount({ title, message, scrollMessage, onDismiss: dismissed,
    buttons: [{ text: 'Close', style: 'cancel', onPress: closeAction }, { text: 'Retry', onPress: retry }] });
  const modal = tree.root.findByType(Modal);
  const card = containers()[1];
  const actions = tree.root.findAllByType(TouchableOpacity);
  const body = scrollMessage ? tree.root.findByType(ScrollView) : null;
  const text = () => [title, message, 'Close', 'Retry'].map(value => tree.root.findAllByType(Text).find(node => node.props.children === value)!);
  let previous = text();
  expect(previous.every(Boolean)).toBe(true);
  for (const scale of [1.35, 1]) {
    await act(async () => { currentScale = scale; subscribers.forEach(update => update(scale)); });
    const current = text();
    current.forEach((node, index) => {
      expect(node).not.toBe(previous[index]);
      expect(node.props.children).toBe([title, message, 'Close', 'Retry'][index]);
      expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    });
    expect(tree.root.findByType(Modal)).toBe(modal);
    expect(modal.props.visible).toBe(true);
    expect(containers()[1]).toBe(card);
    tree.root.findAllByType(TouchableOpacity).forEach((action, index) => expect(action).toBe(actions[index]));
    if (body) expect(tree.root.findByType(ScrollView)).toBe(body);
    expect(retry).not.toHaveBeenCalled(); expect(closeAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); expect(dismissed).not.toHaveBeenCalled();
    previous = current;
  }
  act(() => actions[1].props.onPress());
  expect(retry).toHaveBeenCalledTimes(1); expect(closeAction).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  act(() => actions[0].props.onPress());
  expect(closeAction).toHaveBeenCalledTimes(1); expect(retry).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  expect(dismissed).not.toHaveBeenCalled();
});
