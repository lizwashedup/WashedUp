import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { BroadcastCard } from '../BroadcastCard';
import { AfterglowFallbackFonts, Fonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';
const mockInteractions = jest.fn(), mockReplies = jest.fn(), mockReact = jest.fn(), mockOpenUrl = jest.fn();
let mockFontScale = 1;
const mockFontListeners = new Set<(value: number) => void>();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => {
  const React = require('react'); const [fontScale, setScale] = React.useState(mockFontScale);
  React.useEffect(() => { mockFontListeners.add(setScale); return () => { mockFontListeners.delete(setScale); }; }, []);
  return { width: 390, height: 844, scale: 3, fontScale };
} }));
jest.mock('../../../lib/url', () => ({ ...jest.requireActual('../../../lib/url'), openUrl: (...args: any[]) => mockOpenUrl(...args) }));
jest.mock('../CommunityMessageActions', () => ({ useCommunityMessageInteractions: (...args: any[]) => mockInteractions(...args) }));
jest.mock('../../chat/ReactionEmojiPicker', () => () => null);
let tree: ReactTestRenderer;
const broadcast: any = { id: 'original-broadcast', kind: 'intro', body: 'Hello LA', created_at: '2026-09-15T12:00:00Z', reactions: [], reply_count: 2, payload: { format: 'member_intro_v1', first_name: 'Cedar', answer: 'Hello LA' } };
const scope = { userId: 'member', isCurrent: () => true };
beforeEach(() => { mockFontScale = 1; jest.clearAllMocks(); mockInteractions.mockReset().mockReturnValue({ showReplies: false, draft: '', sending: false, replies: [], repliesLoading: false, repliesError: false, showReactionPicker: false, toggleReplies: mockReplies, openReactionPicker: mockReact }); });
afterEach(() => act(() => tree?.unmount()));
it('uses selected typography while retaining the original introduction and reply control', () => {
  act(() => { tree = create(<BroadcastCard broadcast={broadcast} communityName="Community" scope={scope} onError={jest.fn()} appearance={{ fonts: AfterglowFallbackFonts }} />); });
  expect(mockInteractions.mock.calls[0][0]).toBe(broadcast); expect(mockInteractions.mock.calls[0][2]).toBe(scope);
  const attribution = tree.root.findAllByType(Text).find(node => node.props.children === 'Community')!;
  expect(StyleSheet.flatten(attribution.props.style)).toMatchObject({ fontFamily: AfterglowFallbackFonts.medium, color: AfterglowColors.clay });
  const reply = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Reply to this message')!; act(() => reply.props.onPress()); expect(mockReplies).toHaveBeenCalledTimes(1);
});
it('preserves the default card typography without an appearance option', () => {
  act(() => { tree = create(<BroadcastCard broadcast={broadcast} communityName="Community" scope={scope} onError={jest.fn()} />); });
  const attribution = tree.root.findAllByType(Text).find(node => node.props.children === 'Community')!; expect(StyleSheet.flatten(attribution.props.style).fontFamily).toBe(Fonts.sansBold);
});


it.each(['broadcast', 'intro'] as const)('keeps %s reaction and reply access in its compact conversation surface', kind => {
  const message = { ...broadcast, kind };
  act(() => { tree = create(<BroadcastCard inConversation broadcast={message} communityName="Community" scope={scope} onError={jest.fn()} appearance={{ fonts: AfterglowFallbackFonts }} />); });
  expect(mockInteractions.mock.calls[0][0]).toBe(message);
  expect(mockInteractions.mock.calls[0][2]).toBe(scope);
  expect(mockInteractions.mock.calls[0][3]).toBe('per-emoji');
  const surface = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityHint === 'Hold to react')!;
  act(() => surface.props.onLongPress());
  expect(mockReact).toHaveBeenCalledTimes(1);
  act(() => surface.props.onAccessibilityAction({ nativeEvent: { actionName: 'messageActions' } }));
  expect(mockReact).toHaveBeenCalledTimes(2);
  const reply = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Reply to this message')!;
  act(() => reply.props.onPress());
  expect(mockReplies).toHaveBeenCalledTimes(1);
});


it('keeps a link-only announcement tappable alongside the long-press reaction action', () => {
  const message = { ...broadcast, kind: 'broadcast' as const, body: 'https://example.com/event' };
  act(() => { tree = create(<BroadcastCard inConversation broadcast={message} communityName="Community" scope={scope} onError={jest.fn()} />); });
  const surface = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityHint === 'Hold to react')!;
  act(() => surface.props.onPress());
  expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com/event');
  expect(mockReact).not.toHaveBeenCalled();
});

it('refreshes Reply text without closing its thread or losing an unsent reply', () => {
  mockInteractions.mockImplementation(() => {
    const [draft, changeDraft] = React.useState('');
    const [showReplies, setShowReplies] = React.useState(true);
    return { draft, changeDraft, showReplies, sending: false, replies: [], repliesLoading: false, repliesError: false,
      showReactionPicker: false, toggleReplies: () => setShowReplies(value => !value), openReactionPicker: mockReact };
  });
  act(() => { tree = create(<BroadcastCard inConversation broadcast={broadcast} communityName="Community" scope={scope} onError={jest.fn()} />); });
  const field = tree.root.findByType(TextInput);
  act(() => field.props.onChangeText('Keep this reply'));
  const reply = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Reply to this message')!;
  let label = reply.findByType(Text);
  for (const scale of [2, 1]) {
    act(() => { mockFontScale = scale; mockFontListeners.forEach(update => update(scale)); });
    expect(reply.findByType(Text)).not.toBe(label); label = reply.findByType(Text);
    expect(tree.root.findByType(TextInput)).toBe(field);
    expect(field.props.value).toBe('Keep this reply');
    expect(tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Reply to this message')).toBe(reply);
  }
});
