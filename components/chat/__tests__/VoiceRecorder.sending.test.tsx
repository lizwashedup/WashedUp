import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import VoiceRecorder from '../VoiceRecorder';
import VoicePlayer from '../VoicePlayer';
jest.mock('../VoicePlayer', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let tree: ReactTestRenderer;
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const props = { mode: 'draft' as const, durationMillis: 8000, meterings: [], isPaused: false, draftUri: 'file:///clip.m4a', draftDuration: 8, onTrash: jest.fn(), onPauseResume: jest.fn(), onStop: jest.fn(), onSend: jest.fn() };
afterEach(() => { act(() => tree?.unmount()); jest.clearAllMocks(); });
it('keeps the existing recording preview and send/discard actions by default', () => {
  act(() => { tree = create(<VoiceRecorder {...props} />); });
  expect(tree.root.findByType(VoicePlayer).props).toMatchObject({ uri: props.draftUri, durationSeconds: 8 });
  const buttons = [button('Discard voice message'), button('Send voice message')];
  expect(buttons.map(button => button.props.accessibilityLabel)).toEqual(['Discard voice message', 'Send voice message']);
  act(() => buttons[1].props.onPress()); expect(props.onSend).toHaveBeenCalledTimes(1);
  act(() => buttons[0].props.onPress()); expect(props.onTrash).toHaveBeenCalledTimes(1);
});
it('shows pending delivery and holds send/discard until the attempt settles', () => {
  act(() => { tree = create(<VoiceRecorder {...props} sending />); });
  const buttons = [button('Discard voice message'), button('Sending voice message')];
  expect(buttons.every(button => button.props.disabled)).toBe(true);
  expect(buttons[1].props).toMatchObject({ accessibilityLabel: 'Sending voice message', accessibilityState: { disabled: true, busy: true } });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(tree.root.findByType(VoicePlayer).props.uri).toBe(props.draftUri);
  act(() => tree.update(<VoiceRecorder {...props} sending={false} />));
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(button('Discard voice message').props.disabled).toBe(false);
  expect(button('Send voice message').props.disabled).toBe(false);
});

it('labels the retained recording retry and returns to sending status', () => {
 act(() => { tree=create(<VoiceRecorder {...props} retryAvailable />); });
 expect(button('Retry sending voice message').props.disabled).toBe(false);
 act(() => button('Retry sending voice message').props.onPress());expect(props.onSend).toHaveBeenCalledTimes(1);
 act(() => tree.update(<VoiceRecorder {...props} retryAvailable sending />));
 expect(button('Sending voice message').props.disabled).toBe(true);
 expect(tree.root.findByType(VoicePlayer).props.uri).toBe(props.draftUri);
});
