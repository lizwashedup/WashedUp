import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import YoursTabs, { type YoursTab } from '../YoursTabs';
import { AfterglowFonts, Fonts } from '../../../../constants/Typography';

let mockFontScale = 1;
const mockFontListeners = new Set<(scale: number) => void>();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => {
  const React = require('react');
  const [fontScale, setScale] = React.useState(mockFontScale);
  React.useEffect(() => { mockFontListeners.add(setScale); return () => { mockFontListeners.delete(setScale); }; }, []);
  return { width: 390, height: 844, scale: 3, fontScale };
} }));
jest.mock('../../../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, COMMUNITIES_ENABLED: true }));
function resize(scale: number) { act(() => { mockFontScale = scale; mockFontListeners.forEach(update => update(scale)); }); }
let tree: ReactTestRenderer;
beforeEach(() => { mockFontScale = 1; });
afterEach(() => { act(() => tree?.unmount()); expect(mockFontListeners.size).toBe(0); });

it.each([undefined, { fonts: AfterglowFonts }])('remeasures all mounted tab labels without replacing selection, scroll controller or sibling input (%p)', appearance => {
  let renders = 0;
  const changed = jest.fn();
  function Harness() {
    renders++;
    const [active, setActive] = React.useState<YoursTab>('people');
    const [query, setQuery] = React.useState('Juniper');
    return <><YoursTabs active={active} appearance={appearance} onChange={tab => { changed(tab); setActive(tab); }} />
      <TextInput value={query} onChangeText={setQuery} /></>;
  }
  act(() => { tree = create(<Harness />); });
  const scroll = tree.root.findByType(ScrollView), input = tree.root.findByType(TextInput);
  const tabButtons = () => tree.root.findAll(node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function', { deep: false });
  const buttons = tabButtons();
  const labels = () => buttons.map(button => button.findByType(Text));
  const words = labels().map(label => label.props.children);
  expect(words).toEqual(['Plans', 'People', 'Circles', 'Communities', 'Albums']);
  expect(scroll.props.horizontal).toBe(true);
  expect(buttons[1].props.accessibilityState.selected).toBe(true);
  act(() => { input.props.onChangeText('Juniper saved search'); });
  const settledRenders = renders;
  let prior = labels();
  for (const scale of [2, 1]) {
    resize(scale);
    labels().forEach((label, index) => { expect(label).not.toBe(prior[index]); expect(label.props.children).toBe(words[index]); });
    prior = labels();
    expect(renders).toBe(settledRenders);
    expect(tree.root.findByType(ScrollView)).toBe(scroll);
    expect(tabButtons()).toEqual(buttons);
    expect(tree.root.findByType(TextInput)).toBe(input);
    expect(input.props.value).toBe('Juniper saved search');
    expect(buttons[1].props.accessibilityState.selected).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  }
  // The same measured tab controls still navigate after both size transitions.
  act(() => { buttons[4].props.onLayout({ nativeEvent: { layout: { x: 780 } } }); buttons[4].props.onPress(); });
  expect(changed).toHaveBeenCalledWith('albums');
  expect(buttons[4].props.accessibilityState.selected).toBe(true);
  expect(tree.root.findByType(ScrollView)).toBe(scroll);
  expect(input.props.value).toBe('Juniper saved search');
  resize(2);
  // At a constant enlarged size, changing selection must deliver both the new
  // active weight and the restored inactive weight to the existing native text.
  act(() => { buttons[2].props.onPress(); });
  expect(StyleSheet.flatten(labels()[2].props.style).fontFamily).toBe(appearance?.fonts.semibold ?? Fonts.sansBold);
  expect(StyleSheet.flatten(labels()[1].props.style).fontFamily).toBe(appearance?.fonts.medium ?? Fonts.sansMedium);
  act(() => { buttons[1].props.onPress(); });
  expect(StyleSheet.flatten(labels()[1].props.style).fontFamily).toBe(appearance?.fonts.semibold ?? Fonts.sansBold);
  expect(StyleSheet.flatten(labels()[2].props.style).fontFamily).toBe(appearance?.fonts.medium ?? Fonts.sansMedium);
  expect(labels()[3].props.children).toBe('Communities');
  expect(labels()[4].props.children).toBe('Albums');
  expect(tree.root.findByType(ScrollView)).toBe(scroll);
  expect(input.props.value).toBe('Juniper saved search');
});
