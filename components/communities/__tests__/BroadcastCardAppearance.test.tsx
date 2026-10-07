import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { BroadcastCard } from '../BroadcastCard';
import { AfterglowFallbackFonts, Fonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';
const mockInteractions = jest.fn(), mockReplies = jest.fn();
jest.mock('../CommunityMessageActions', () => ({ useCommunityMessageInteractions: (...args: any[]) => mockInteractions(...args) }));
jest.mock('../../chat/ReactionEmojiPicker', () => () => null);
let tree: ReactTestRenderer;
const broadcast: any = { id: 'original-broadcast', kind: 'intro', body: 'Hello LA', created_at: '2026-09-15T12:00:00Z', reactions: [], reply_count: 2, payload: { format: 'member_intro_v1', first_name: 'Cedar', answer: 'Hello LA' } };
const scope = { userId: 'member', isCurrent: () => true };
beforeEach(() => { jest.clearAllMocks(); mockInteractions.mockReturnValue({ showReplies: false, draft: '', sending: false, replies: [], repliesLoading: false, repliesError: false, showReactionPicker: false, toggleReplies: mockReplies }); });
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
