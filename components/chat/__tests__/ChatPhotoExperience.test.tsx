import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { GestureDetector } from 'react-native-gesture-handler';
import { ChatPhotoAttachment } from '../ChatPhotoAttachment';
import { ChatPhotoViewer, useChatPhotoSelection, type ChatPhoto } from '../ChatPhotoViewer';
import { AfterglowFonts } from '../../../constants/Typography';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: require('react-native').View, SafeAreaView: require('react-native').View }));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureHandlerRootView: require('react-native').View,
  GestureDetector: (props: any) => require('react').createElement(require('react-native').View, props),
}));
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current };
});

let tree: ReactTestRenderer;
afterEach(() => { act(() => tree?.unmount()); });
const photos: ChatPhoto[] = [
  { id: 'photo-a', uri: 'https://example.test/a.jpg', senderName: 'Amelia', caption: 'Meet by these courts.' },
  { id: 'photo-b', uri: 'https://example.test/b.jpg', senderName: 'Jamie' },
  { id: 'photo-c', uri: 'https://example.test/c.jpg', senderName: 'Liz' },
];
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const loaded = { source: { width: 1200, height: 1600 } };
const image = () => tree.root.findByType(Image);

it('opens an uncropped portrait, while keeping the original long-press action', () => {
  const onOpen = jest.fn(), onLongPress = jest.fn();
  act(() => { tree = create(<ChatPhotoAttachment uri="https://example.test/portrait.jpg" maxWidth={220} senderName="Amelia" fonts={AfterglowFonts} onOpen={onOpen} onLongPress={onLongPress} />); });
  act(() => image().props.onLoad(loaded));
  expect(image().props.contentFit).toBe('contain');
  const target = button('Open photo from Amelia');
  const bounds = StyleSheet.flatten(target.props.style);
  expect(bounds.width).toBeCloseTo(220);
  expect(bounds.height).toBeCloseTo(293.333);
  act(() => { target.props.onPress(); target.props.onLongPress(); });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onLongPress).toHaveBeenCalledTimes(1);
  act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: 'messageActions' } }));
  expect(onLongPress).toHaveBeenCalledTimes(2);
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it('keeps retry usable for a cached panorama and ignores retired image attempts', () => {
  const props = { uri: 'https://example.test/panorama.jpg', maxWidth: 220, fonts: AfterglowFonts, onOpen: jest.fn(), onLongPress: jest.fn() };
  act(() => { tree = create(<ChatPhotoAttachment {...props} />); });
  const retired = image().props;
  act(() => retired.onLoad({ source: { width: 10000, height: 100 } }));
  act(() => retired.onError());
  expect(StyleSheet.flatten(button('Retry loading photo').props.style).height).toBeGreaterThanOrEqual(100);
  act(() => button('Retry loading photo').props.onPress());
  const retry = image().props;
  act(() => { retry.onLoad(loaded); retired.onError(); retired.onLoad({ source: { width: 1, height: 1 } }); });
  expect(button('Retry loading photo')).toBeUndefined();
  expect(StyleSheet.flatten(button('Open photo').props.style).height).toBeCloseTo(293.333);
});

it('clears a recycled thumbnail error and dimensions on a different URI', () => {
  const props = { uri: 'https://example.test/recycled-a.jpg', maxWidth: 220, fonts: AfterglowFonts, onOpen: jest.fn(), onLongPress: jest.fn() };
  act(() => { tree = create(<ChatPhotoAttachment {...props} />); });
  const old = image().props;
  act(() => old.onError());
  act(() => tree.update(<ChatPhotoAttachment {...props} uri="https://example.test/recycled-b.jpg" />));
  act(() => old.onError());
  expect(button('Retry loading photo')).toBeUndefined();
  expect(image().props.source.uri).toBe('https://example.test/recycled-b.jpg');
});

let current: ReturnType<typeof useChatPhotoSelection>;
function Session({ scope = 'community:a:alice', items = photos }: { scope?: string; items?: ChatPhoto[] }) {
  current = useChatPhotoSelection(scope, items);
  return <ChatPhotoViewer photos={items} {...current} fonts={AfterglowFonts} />;
}
function mountSession() { act(() => { tree = create(<Session />); }); }

it('opens by message identity, browses photos, and closes without resetting the chat', () => {
  mountSession();
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  act(() => current.onSelect('photo-a'));
  expect(button('Previous photo').props.disabled).toBe(true);
  act(() => button('Next photo').props.onPress());
  expect(image().props.source.uri).toBe(photos[1].uri);
  act(() => button('Close photo').props.onPress());
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
});

it('closes when a photo is removed and does not silently reopen if it comes back', () => {
  mountSession();
  act(() => current.onSelect('photo-a'));
  act(() => tree.update(<Session items={photos.slice(1)} />));
  expect(current.selectedId).toBeNull();
  act(() => tree.update(<Session />));
  expect(current.selectedId).toBeNull();
});

it('retires both open and close callbacks across A → B → A and account changes', () => {
  mountSession();
  const oldA = current;
  act(() => current.onSelect('photo-a'));
  act(() => tree.update(<Session scope="community:b:alice" />));
  expect(current.selectedId).toBeNull();
  act(() => current.onSelect('photo-b'));
  act(() => { oldA.onClose(); oldA.onSelect('photo-a'); });
  expect(current.selectedId).toBe('photo-b');
  act(() => tree.update(<Session />));
  act(() => oldA.onSelect('photo-a'));
  expect(current.selectedId).toBeNull();
  act(() => current.onSelect('photo-c'));
  act(() => tree.update(<Session scope="community:a:bob" />));
  expect(current.selectedId).toBeNull();
});

it('shows full-photo load failure, retries, and rejects an old attempt’s completion', () => {
  mountSession();
  act(() => current.onSelect('photo-a'));
  const retired = image().props;
  expect(button('Zoom in on photo').props.disabled).toBe(true);
  act(() => retired.onError());
  expect(button('Retry photo')).toBeDefined();
  act(() => button('Retry photo').props.onPress());
  act(() => image().props.onLoad(loaded));
  act(() => { retired.onError(); retired.onLoad({ source: { width: 1, height: 1 } }); });
  expect(button('Retry photo')).toBeUndefined();
  expect(button('Zoom in on photo').props.disabled).toBe(false);
});

function findGesture(testID: string): any {
  const search = (gesture: any): any => gesture.config?.testId === testID ? gesture : gesture.gestures?.map(search).find(Boolean);
  return search(tree.root.findByType(GestureDetector).props.gesture);
}

it('does not navigate on a cancelled pinch-start pan or from a retired photo gesture', () => {
  mountSession();
  act(() => current.onSelect('photo-a'));
  act(() => image().props.onLoad(loaded));
  const pan = findGesture('photo-pan');
  expect(pan).toBeDefined();
  const swipe = { translationX: -200, translationY: 0 };
  act(() => pan.handlers.onEnd(swipe, false));
  expect(current.selectedId).toBe('photo-a');
  act(() => pan.handlers.onEnd(swipe, true));
  expect(current.selectedId).toBe('photo-b');
  act(() => pan.handlers.onEnd({ translationX: 200, translationY: 0 }, true));
  expect(current.selectedId).toBe('photo-b');
});

it('panning an enlarged photo does not navigate to another image', () => {
  mountSession();
  act(() => current.onSelect('photo-a'));
  act(() => image().props.onLoad(loaded));
  const pinch = findGesture('photo-pinch'), pan = findGesture('photo-pan');
  act(() => {
    pinch.handlers.onStart({ focalX: 180, focalY: 250 });
    pinch.handlers.onUpdate({ scale: 2, focalX: 180, focalY: 250 });
    pan.handlers.onEnd({ translationX: -200, translationY: 0 }, true);
  });
  expect(current.selectedId).toBe('photo-a');
});
