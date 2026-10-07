import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { AfterglowFonts, Fonts, FontSizes } from '../../../constants/Typography';
import { GiphyGridView } from '../GiphyGrid';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('@shopify/flash-list', () => ({ FlashList: (props: any) => {
  const { createElement: element, Fragment } = require('react'); const { View } = require('react-native');
  return element(View, null, Array.isArray(props.data) && props.data.length ? props.data.slice(0, 12).map((item: string) => element(Fragment, { key: item }, props.renderItem({ item }))) : props.ListEmptyComponent);
} }));
jest.mock('../GiphyGrid', () => ({ GiphyGridView: () => null, GiphyContent: { search: (value: unknown) => ({ kind: 'search', ...value as object }), trending: () => ({ kind: 'trending' }) } }));
jest.mock('../../../constants/LocalDevelopment', () => ({ LOCAL_DEVELOPMENT_ONLY: false }));

// The component snapshots its build-time key on import. Use a local marker to
// exercise native callback contracts; the grid is mocked and no provider runs.
const originalGiphyKey = process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;
process.env.EXPO_PUBLIC_GIPHY_SDK_KEY = 'local-test-only';
const MediaPanel = require('../MediaPanel').default as typeof import('../MediaPanel').default;
const isChatGifPickerAvailable = require('../MediaPanel').isChatGifPickerAvailable as typeof import('../MediaPanel').isChatGifPickerAvailable;
if (originalGiphyKey === undefined) delete process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;
else process.env.EXPO_PUBLIC_GIPHY_SDK_KEY = originalGiphyKey;

let tree: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); jest.requireMock('../../../constants/LocalDevelopment').LOCAL_DEVELOPMENT_ONLY = false; (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null); (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined); });
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });
const buttons = () => tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
const action = (name: string) => buttons().find(n => n.props.accessibilityLabel === name)!;
const data = () => tree.root.findByType(FlashList).props.data as string[];
async function mount(staged = true, mode?: 'emoji-gif' | 'gif-only') {
  const onSelect = jest.fn(), onBackspace = jest.fn(), onGifSelect = jest.fn();
  await act(async () => { tree = create(<MediaPanel height={300} bottomInset={34} appearance={staged ? { fonts: AfterglowFonts } : undefined} onSelect={onSelect} onBackspace={onBackspace} onGifSelect={onGifSelect} mode={mode} />); });
  return { onSelect, onBackspace, onGifSelect };
}

it('keeps default fonts, labels and category layout when appearance is omitted', async () => {
  await mount(false);
  expect(StyleSheet.flatten(tree.root.findByType(TextInput).props.style)).toMatchObject({ fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD });
  expect(action('Delete')).toBeDefined();
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(action('Emoji').props.accessibilityState).toBeUndefined();
});

it('keeps search mounted, clears the query explicitly and preserves message deletion and emoji selection', async () => {
  const callbacks = await mount(); const input = tree.root.findByType(TextInput);
  const focus = jest.spyOn(input.instance, 'focus');
  act(() => input.props.onChangeText('sun'));
  expect(data().length).toBeGreaterThan(0);
  expect(tree.root.findByType(TextInput)).toBe(input);
  expect(input.props.value).toBe('sun');
  act(() => action('Clear search').props.onPress());
  expect(input.props.value).toBe('');
  expect(focus).toHaveBeenCalledTimes(1);
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  act(() => action('Delete from message').props.onPress());
  expect(callbacks.onBackspace).toHaveBeenCalledTimes(1);
  const emoji = data()[0];
  act(() => buttons().find(n => !['Emoji','GIFs','Delete from message'].includes(n.props.accessibilityLabel) && !n.props.accessibilityLabel.endsWith(' emoji'))!.props.onPress());
  expect(callbacks.onSelect).toHaveBeenCalledWith(emoji);
  expect(callbacks.onGifSelect).not.toHaveBeenCalled();
});

it('makes every staged category scrollable and selected with a reachable target', async () => {
  await mount(); const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.horizontal).toBe(true);
  for (const choice of scroll.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')) {
    expect(StyleSheet.flatten(choice.props.style)).toMatchObject({ minWidth: 48, minHeight: 44 });
  }
  act(() => action('flags emoji').props.onPress());
  expect(action('flags emoji').props.accessibilityState).toEqual({ selected: true });
  expect(data().length).toBeGreaterThan(0);
  const input = tree.root.findByType(TextInput);
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({ fontFamily: AfterglowFonts.regular, minHeight: 44, fontSize: 16 });
  expect(input.props.allowFontScaling).not.toBe(false);
});

it.each(['{"corrupt":true}', 'null', 'true', '42', '"hello"', '[not JSON'])('treats malformed recent preference %s as empty rather than rendering invalid data', async saved => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(saved);
  await mount(); act(() => action('recent emoji').props.onPress());
  expect(data()).toEqual([]);
});

it('deduplicates and validates loaded recents without overwriting an emoji just selected', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise<string>(r => { resolve = r; }));
  const { onSelect } = await mount(); const chosen = data()[0];
  act(() => buttons().find(n => !['Emoji','GIFs','Delete from message'].includes(n.props.accessibilityLabel) && !n.props.accessibilityLabel.endsWith(' emoji'))!.props.onPress());
  await act(async () => resolve(JSON.stringify(['☀️','☀️',null,45,'not an emoji'])));
  act(() => action('recent emoji').props.onPress());
  expect(data()).toEqual([chosen,'☀️']);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it('persists the merged recent history when an emoji was selected before hydration finished', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise<string>(r => { resolve = r; }));
  await mount();
  const list = tree.root.findByType(FlashList);
  const chosen = data()[0];
  act(() => list.props.renderItem({ item: chosen }).props.onPress());
  await act(async () => resolve(JSON.stringify(['☀️', '☀️', null])));
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('chat_emoji_recents', JSON.stringify([chosen, '☀️']));
});

it.each(['ios', 'android'] as const)('preserves the shared search and original GIF payload callbacks on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const callbacks = await mount();
  const input = tree.root.findByType(TextInput);
  act(() => input.props.onChangeText('  sunset  '));
  act(() => action('GIFs').props.onPress());
  expect(tree.root.findByType(TextInput)).toBe(input);
  expect(input.props.value).toBe('  sunset  ');
  expect(input.props.accessibilityLabel).toBe('Search GIFs');
  expect(action('GIFs').props.accessibilityState).toEqual({ selected: true });
  expect(action('Delete from message')).toBeUndefined();
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  const grid = () => tree.root.findByType(GiphyGridView);
  expect(grid().props).toMatchObject({ content: { kind: 'search', searchQuery: 'sunset' }, spanCount: 3, cellPadding: 4 });
  act(() => grid().props.onMediaSelect({ nativeEvent: { media: { data: { images: { original: { url: 'https://example.test/original.gif' } } }, url: 'https://example.test/fallback.gif' } } }));
  act(() => grid().props.onMediaSelect({ nativeEvent: { media: { url: 'https://example.test/fallback.gif' } } }));
  act(() => grid().props.onMediaSelect({ nativeEvent: {} }));
  expect(callbacks.onGifSelect.mock.calls).toEqual([['https://example.test/original.gif'], ['https://example.test/fallback.gif']]);
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  expect(callbacks.onBackspace).not.toHaveBeenCalled();
  act(() => action('Clear search').props.onPress());
  expect(grid().props.content).toEqual({ kind: 'trending' });
  act(() => action('Emoji').props.onPress());
  expect(tree.root.findByType(TextInput)).toBe(input);
  expect(input.props.accessibilityLabel).toBe('Search emoji');
  expect(action('Delete from message')).toBeDefined();
});

it('shows the existing unavailable GIF state on web without invoking a media callback', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const callbacks = await mount();
  act(() => action('GIFs').props.onPress());
  expect(tree.root.findAllByType(GiphyGridView)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'GIFs are unavailable right now.')).toBe(true);
  expect(callbacks.onGifSelect).not.toHaveBeenCalled();
  act(() => action('Emoji').props.onPress());
  expect(data().length).toBeGreaterThan(0);
});

it('preserves panel dimensions and reachable staged search/tab controls while category choice survives search', async () => {
  await mount();
  expect(StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style)).toMatchObject({ height: 300, paddingBottom: 34 });
  for (const label of ['Emoji', 'GIFs', 'Delete from message']) {
    const style = StyleSheet.flatten(action(label).props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  }
  act(() => action('flags emoji').props.onPress());
  const flags = [...data()];
  act(() => tree.root.findByType(TextInput).props.onChangeText('smile'));
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(StyleSheet.flatten(action('Clear search').props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  act(() => action('Clear search').props.onPress());
  expect(action('flags emoji').props.accessibilityState).toEqual({ selected: true });
  expect(data()).toEqual(flags);
});

it('keeps local emoji selection usable when recent preference storage fails', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage read failed'));
  (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('storage write failed'));
  const { onSelect } = await mount();
  const list = tree.root.findByType(FlashList), chosen = data()[0];
  await act(async () => list.props.renderItem({ item: chosen }).props.onPress());
  act(() => action('recent emoji').props.onPress());
  expect(data()).toEqual([chosen]);
  expect(onSelect).toHaveBeenCalledWith(chosen);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it.each(['ios', 'android'] as const)('opens GIF-only mode directly on %s without emoji tabs, deletion controls or recent storage', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const callbacks = await mount(true, 'gif-only');
  expect(isChatGifPickerAvailable()).toBe(true);
  expect(action('Emoji')).toBeUndefined();
  expect(action('GIFs')).toBeUndefined();
  expect(action('Delete from message')).toBeUndefined();
  expect(tree.root.findAllByType(FlashList)).toHaveLength(0);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  const input = tree.root.findByType(TextInput);
  expect(input.props.accessibilityLabel).toBe('Search GIFs');
  expect(tree.root.findByType(GiphyGridView).props.content).toEqual({ kind: 'trending' });
  act(() => input.props.onChangeText('  sunset  '));
  const grid = tree.root.findByType(GiphyGridView);
  expect(grid.props.content).toEqual({ kind: 'search', searchQuery: 'sunset' });
  act(() => grid.props.onMediaSelect({ nativeEvent: { media: { url: 'https://example.invalid/selected.gif' } } }));
  expect(callbacks.onGifSelect).toHaveBeenCalledWith('https://example.invalid/selected.gif');
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  expect(callbacks.onBackspace).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it.each(['web', 'ios'] as const)('does not expose an unavailable GIF grid for %s or the isolated no-provider bootstrap', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  if (platform === 'ios') jest.requireMock('../../../constants/LocalDevelopment').LOCAL_DEVELOPMENT_ONLY = true;
  expect(isChatGifPickerAvailable()).toBe(false);
  await mount(true, 'gif-only');
  expect(tree.root.findAllByType(GiphyGridView)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'GIFs are unavailable right now.')).toBe(true);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

it('keeps the attachment GIF capability unavailable when the build has no SDK key', () => {
  const before = process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;
  delete process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;
  try {
    jest.isolateModules(() => {
      const capability = require('../MediaPanel').isChatGifPickerAvailable;
      expect(capability()).toBe(false);
    });
  } finally {
    if (before === undefined) delete process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;
    else process.env.EXPO_PUBLIC_GIPHY_SDK_KEY = before;
  }
});

it('retires an old emoji preference hydration when the same panel changes to GIF-only mode', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise<string>(yes => { resolve = yes; }));
  const callbacks = await mount();
  act(() => tree.update(<MediaPanel height={300} bottomInset={34} appearance={{ fonts: AfterglowFonts }} {...callbacks} mode="gif-only" />));
  await act(async () => resolve('["☀️"]'));
  expect(tree.root.findAllByType(FlashList)).toHaveLength(0);
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(action('Emoji')).toBeUndefined();
});
