import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import PushPrimerModal from '../PushPrimerModal';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { AfterglowFallbackFonts, AfterglowFonts, Fonts } from '../../constants/Typography';

let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); });

function button(label: string) {
  return tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
}
function text(content: string) {
  return tree.root.findAllByType(Text).find(node => node.props.children === content)!;
}
function card() {
  return tree.root.findAllByType(View).find(node => node.props.accessibilityViewIsModal)!;
}

it('supports the existing contract without starting any action on presentation', async () => {
  const onEnable = jest.fn();
  const onDismiss = jest.fn();
  await act(async () => { tree = create(<PushPrimerModal visible onEnable={onEnable} onDismiss={onDismiss} />); });
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  expect(onEnable).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(StyleSheet.flatten(card().props.style).backgroundColor).toBe(Colors.white);
  expect(StyleSheet.flatten(text('Stay in the loop').props.style).fontFamily).toBe(Fonts.displayBold);
  expect(text('Stay in the loop').props.accessibilityRole).toBe('header');
  expect(button('Enable notifications').findByType(Text).props.children).toBe('Enable');
  act(() => button('Enable notifications').props.onPress());
  expect(onEnable).toHaveBeenCalledTimes(1);
  act(() => tree.update(<PushPrimerModal visible={false} onEnable={onEnable} onDismiss={onDismiss} />));
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
});

it('blocks enable while pending and keeps every dismissal route available', async () => {
  const onEnable = jest.fn();
  const onDismiss = jest.fn();
  await act(async () => {
    tree = create(<PushPrimerModal visible pending onEnable={onEnable} onDismiss={onDismiss} appearance={{ fonts: AfterglowFonts }} />);
  });
  const enable = button('Turning on notifications');
  expect(enable.props.disabled).toBe(true);
  expect(enable.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(enable.findByType(Text).props.children).toBe('Turning on…');
  act(() => { enable.props.onPress(); enable.props.onPress(); });
  expect(onEnable).not.toHaveBeenCalled();
  expect(button('Close notifications reminder').props.disabled).not.toBe(true);
  expect(button('Not now').props.disabled).not.toBe(true);
  act(() => {
    button('Close notifications reminder').props.onPress();
    button('Not now').props.onPress();
    tree.root.findByType(Modal).props.onRequestClose();
    card().props.onAccessibilityEscape();
  });
  expect(onDismiss).toHaveBeenCalledTimes(4);
});

it('announces caller feedback, allows retry, and clears stale feedback during that attempt', async () => {
  const onEnable = jest.fn();
  const onDismiss = jest.fn();
  const feedback = 'We couldn’t finish setting up notifications. Please try again.';
  const props = { visible: true, onEnable, onDismiss, feedback };
  await act(async () => { tree = create(<PushPrimerModal {...props} />); });
  expect(text(feedback).props).toMatchObject({ accessibilityRole: 'alert', accessibilityLiveRegion: 'polite' });
  expect(button('Enable notifications').props.disabled).toBe(false);
  act(() => button('Enable notifications').props.onPress());
  expect(onEnable).toHaveBeenCalledTimes(1);

  act(() => tree.update(<PushPrimerModal {...props} pending />));
  expect(text(feedback)).toBeUndefined();
  act(() => button('Turning on notifications').props.onPress());
  expect(onEnable).toHaveBeenCalledTimes(1);

  act(() => tree.update(<PushPrimerModal {...props} />));
  expect(text(feedback)).toBeDefined();
  act(() => button('Enable notifications').props.onPress());
  expect(onEnable).toHaveBeenCalledTimes(2);
});

it.each([false, true])('provides accessible touch targets and scrollable scalable content with staged appearance %s', async staged => {
  await act(async () => {
    tree = create(<PushPrimerModal visible onEnable={jest.fn()} onDismiss={jest.fn()} appearance={staged ? { fonts: AfterglowFonts } : undefined} />);
  });
  for (const control of tree.root.findAllByType(TouchableOpacity)) {
    const style = StyleSheet.flatten(control.props.style);
    expect(control.props.accessibilityRole).toBe('button');
    expect(control.props.accessibilityLabel).toBeTruthy();
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  }
  for (const control of [button('Enable notifications'), button('Not now')]) {
    const label = control.findByType(Text);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.allowFontScaling).not.toBe(false);
  }
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.findAllByType(TouchableOpacity)).toHaveLength(2);
  expect(scroll.findAllByType(Text)).toContain(text('Stay in the loop'));
  const body = scroll.findAllByType(Text).find(node => typeof node.props.children === 'string' && node.props.children.startsWith('Turn on notifications'))!;
  expect(body.props.numberOfLines).toBeUndefined();
  expect(body.props.allowFontScaling).not.toBe(false);
  expect(body.props.maxFontSizeMultiplier).toBeUndefined();
  expect(StyleSheet.flatten(card().props.style)).toMatchObject({ maxHeight: '100%', flexShrink: 1 });
  expect(StyleSheet.flatten(scroll.props.style).flexShrink).toBe(1);
});

it('accepts fallback fonts before the reviewed fonts load and restores legacy appearance when omitted', async () => {
  const props = { visible: true, onEnable: jest.fn(), onDismiss: jest.fn() };
  await act(async () => { tree = create(<PushPrimerModal {...props} appearance={{ fonts: AfterglowFallbackFonts }} />); });
  expect(StyleSheet.flatten(text('Stay in the loop').props.style).fontFamily).toBe(AfterglowFallbackFonts.display);
  expect(StyleSheet.flatten(card().props.style)).toMatchObject({ backgroundColor: AfterglowColors.paper, borderRadius: 6 });

  act(() => tree.update(<PushPrimerModal {...props} appearance={{ fonts: AfterglowFonts }} />));
  expect(StyleSheet.flatten(text('Stay in the loop').props.style)).toMatchObject({ fontFamily: AfterglowFonts.display, color: AfterglowColors.ink });
  expect(StyleSheet.flatten(button('Enable notifications').props.style)).toMatchObject({ backgroundColor: AfterglowColors.clay, borderRadius: 6 });

  act(() => tree.update(<PushPrimerModal {...props} />));
  expect(StyleSheet.flatten(text('Stay in the loop').props.style).fontFamily).toBe(Fonts.displayBold);
  expect(StyleSheet.flatten(card().props.style).backgroundColor).toBe(Colors.white);
});
