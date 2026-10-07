jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
jest.mock('../../creator/CreatorActionFill', () => ({ CreatorActionFill: () => null }));

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView, type EdgeInsets } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatEntryState } from '../ChatEntryState';

let tree: ReactTestRenderer | undefined;
const notchInsets = { top: 59, bottom: 34, left: 0, right: 0 };
const back = jest.fn();
const retry = jest.fn();
type EntryProps = React.ComponentProps<typeof ChatEntryState>;

function entry(props: Partial<EntryProps> = {}, insets: EdgeInsets = notchInsets) {
  return <SafeAreaInsetsContext.Provider value={insets}>
    <ChatEntryState state="loading" onBack={back} {...props} />
  </SafeAreaInsetsContext.Provider>;
}
function buttons() { return tree!.root.findAllByType(TouchableOpacity); }
function rootStyle() { return StyleSheet.flatten(tree!.root.findAllByType(View)[0].props.style); }

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

it.each([
  ['loading', 'Opening your chat', 'Getting your conversation ready…'],
  ['error', 'Chat couldn’t load', 'Check your connection and try again.'],
  ['unavailable', 'Chat unavailable', 'Return to Chats to see your available conversations.'],
] as const)('protects the first %s render using current top and bottom insets without a native layout event', (state, title, body) => {
  act(() => { tree = create(entry({ state })); });
  // No onLayout, timers or safe-area native event is delivered before checking.
  expect(rootStyle()).toMatchObject({ flex: 1, paddingTop: 59, paddingBottom: 34 });
  expect(tree!.root.findAllByType(SafeAreaView)).toHaveLength(0);
  const text = tree!.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toEqual(expect.arrayContaining(['Chats', title, body]));
  expect(tree!.root.findAllByType(ActivityIndicator)).toHaveLength(state === 'loading' ? 1 : 0);
  expect(back).not.toHaveBeenCalled();
});

it('updates inset protection exactly once when the root metrics change', () => {
  act(() => { tree = create(entry()); });
  act(() => tree!.update(entry({}, { top: 0, bottom: 21, left: 44, right: 44 })));
  expect(rootStyle()).toMatchObject({ paddingTop: 0, paddingBottom: 21 });
  // Preserve the former top/bottom-only contract; do not add side padding.
  expect(rootStyle().paddingLeft).toBeUndefined();
  expect(rootStyle().paddingRight).toBeUndefined();
  act(() => tree!.update(entry()));
  expect(rootStyle()).toMatchObject({ paddingTop: 59, paddingBottom: 34 });
});

it('retains explicit back/retry callbacks and retry busy state without triggering actions on entry', () => {
  act(() => { tree = create(entry({ state: 'error', onRetry: retry })); });
  expect(back).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
  act(() => {
    buttons().find(button => button.props.accessibilityLabel === 'Back to Chats')!.props.onPress();
    buttons().find(button => button.props.accessibilityLabel === 'Retry opening chat')!.props.onPress();
  });
  expect(back).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
  act(() => tree!.update(entry({ state: 'error', onRetry: retry, retrying: true })));
  const retryButton = buttons().find(button => button.props.accessibilityLabel === 'Retry opening chat')!;
  expect(retryButton.props.disabled).toBe(true);
  expect(retryButton.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(retryButton.findAllByType(Text).map(node => node.props.children)).toContain('Trying…');
  act(() => tree!.update(entry({ state: 'loading', onRetry: retry })));
  expect(buttons().map(button => button.props.accessibilityLabel)).toEqual(['Back to Chats']);
  expect(retry).toHaveBeenCalledTimes(1);
});
