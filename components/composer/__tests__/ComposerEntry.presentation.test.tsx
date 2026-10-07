import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import EditorialTitleField from '../EditorialTitleField';
import CategoryChips from '../CategoryChips';
import InlineNudge from '../InlineNudge';
import { AfterglowFonts, Fonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';
import { PLAN_CATEGORIES } from '../../../constants/Categories';
import { hapticSelection } from '../../../lib/haptics';

jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
const appearance = { fonts: AfterglowFonts };
const trees: ReactTestRenderer[] = [];
function mount(element: React.ReactElement) { let tree!: ReactTestRenderer; act(() => { tree = create(element); }); trees.push(tree); return tree; }
function action(tree: ReactTestRenderer, label: string) { return tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]; }
afterEach(() => { act(() => { trees.splice(0).forEach(tree => tree.unmount()); }); jest.clearAllMocks(); });

it('keeps controlled title entry, limits, autofocus and keyboard semantics on the same input', () => {
  const change = jest.fn(); const tree = mount(<EditorialTitleField value="" onChangeText={change} placeholder="A plan title" label="What" maxLength={64} autoFocus appearance={appearance} />);
  const input = tree.root.findByType(TextInput);
  expect(input.props).toMatchObject({ value: '', maxLength: 64, autoFocus: true, returnKeyType: 'next', multiline: false, accessibilityLabel: 'What, plan title' });
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({ fontFamily: AfterglowFonts.display, minHeight: 48, color: AfterglowColors.ink });
  act(() => { input.props.onChangeText('A slow Sunday'); }); expect(change).toHaveBeenCalledWith('A slow Sunday');
  act(() => { tree.update(<EditorialTitleField value="A slow Sunday" onChangeText={change} placeholder="A plan title" label="What" maxLength={64} autoFocus appearance={appearance} />); });
  expect(tree.root.findByType(TextInput)).toBe(input); expect(input.props.value).toBe('A slow Sunday');
});

it('retains default title family and default 80-character limit', () => {
  const tree = mount(<EditorialTitleField value="" onChangeText={jest.fn()} placeholder="Title" />);
  const input = tree.root.findByType(TextInput);
  expect(input.props.maxLength).toBe(80); expect(StyleSheet.flatten(input.props.style).fontFamily).toBe(Fonts.display);
});

it('keeps the canonical category set and emitted value while exposing selection with 44px actions', () => {
  const select = jest.fn(); const tree = mount(<CategoryChips selected="Food" onSelect={select} appearance={appearance} />);
  const strip = tree.root.findByType(ScrollView);
  expect(strip.props.horizontal).toBe(true);
  expect(StyleSheet.flatten(strip.props.contentContainerStyle).flexWrap).toBe('nowrap');
  for (const category of PLAN_CATEGORIES) {
    const item = action(tree, category); expect(item).toBeDefined();
    expect(item.props.accessibilityState.selected).toBe(category === 'Food');
    expect(StyleSheet.flatten(item.props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
  act(() => { action(tree, 'Outdoors').props.onPress(); });
  expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith('Outdoors'); expect(hapticSelection).toHaveBeenCalledTimes(1);
  act(() => { tree.update(<CategoryChips selected="Outdoors" onSelect={select} appearance={appearance} />); });
  expect(action(tree, 'Outdoors').props.accessibilityState.selected).toBe(true); expect(action(tree, 'Food').props.accessibilityState.selected).toBe(false);
});

it('preserves the lowercase legacy category labels and rounded treatment', () => {
  const tree = mount(<CategoryChips selected={null} onSelect={jest.fn()} />);
  expect(StyleSheet.flatten(action(tree, 'outdoors').props.style).borderRadius).toBe(20);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'outdoors')).toBe(true);
});

it('keeps informational nudges noninteractive and the optional whole-nudge action intact', () => {
  const plain = mount(<InlineNudge text="You can decide on a place later." appearance={appearance} />);
  expect(plain.root.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
  const press = jest.fn(); const text = 'Move this link to the details.';
  const interactive = mount(<InlineNudge text={text} onPress={press} actionLabel="Move link" appearance={appearance} />);
  const button = action(interactive, `Move link. ${text}`);
  expect(button).toBeDefined(); act(() => { button.props.onPress(); }); expect(press).toHaveBeenCalledTimes(1);
  const box = button.findAll(node => StyleSheet.flatten(node.props.style)?.minHeight === 44)[0];
  expect(StyleSheet.flatten(box.props.style)).toMatchObject({ borderRadius: 4, backgroundColor: AfterglowColors.white });
  expect(interactive.root.findAllByType(Text).some(node => node.props.children === text)).toBe(true);
});
