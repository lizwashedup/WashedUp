import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
const mockSource = jest.fn(() => ({ source: undefined, error: true, retry: jest.fn(), fail: jest.fn(), current: () => false }));
jest.mock('../../../hooks/useEventMediaSource', () => ({ useEventMediaSource: (...args: unknown[]) => (mockSource as jest.Mock)(...args) }));
import { CommunityChatRow } from '../CommunityChatRow';
import { ChatInboxRow } from '../ChatInboxRow';
import { EventMediaImage } from '../../events/EventMediaImage';
import { AfterglowFonts } from '../../../constants/Typography';
import type { CommunityChatRowData } from '../../../lib/communityChat';
const eventId = '11111111-1111-4111-8111-111111111111';
const reference = `creator-event-media:${eventId}/private-22222222-2222-4222-8222-222222222222.jpg`;
const row = { key:'topic', kind:'room', targetId:'topic-id', communityId:'community', title:'Our event chat', secondary:'The page', preview:'See you there', lastAt:null, unread:2, accent:null, image:reference, eventId } as CommunityChatRowData;
let tree: ReactTestRenderer;
afterEach(() => { act(() => tree?.unmount()); jest.clearAllMocks(); });
it.each([false,true])('carries exact event identity through the existing chat row, reviewed appearance=%s', reviewed => {
  const open = jest.fn(); act(() => { tree=create(<CommunityChatRow row={row} onPress={open} conversationFonts={reviewed?AfterglowFonts:undefined} />); });
  const image=tree.root.findByType(EventMediaImage); expect(image.props.eventId).toBe(eventId); expect(image.props.reference).toBe(reference);
  expect(mockSource).toHaveBeenCalledWith(eventId,reference,'cover');
  const button=tree.root.findByType(TouchableOpacity); expect(button.props.accessibilityLabel).toContain('2 unread');
  act(() => button.props.onPress()); expect(open).toHaveBeenCalledTimes(1);
});
it('preserves public person images without requesting event permissions', () => {
  act(() => { tree=create(<ChatInboxRow identity="person" title="Cedar" preview="Hello" image="https://legacy/avatar.jpg" person unread={0} fonts={AfterglowFonts} onPress={jest.fn()} />); });
  expect(tree.root.findByType(Image).props.source.uri).toBe('https://legacy/avatar.jpg'); expect(mockSource).not.toHaveBeenCalled();
});
it('does not infer event authority from a stale row without explicit event provenance', () => {
  act(() => { tree=create(<CommunityChatRow row={{...row,eventId:undefined}} onPress={jest.fn()} conversationFonts={AfterglowFonts} />); });
  expect(tree.root.findByType(EventMediaImage).props.eventId).toBe(''); expect(mockSource).toHaveBeenCalledWith('',reference,'cover');
});
