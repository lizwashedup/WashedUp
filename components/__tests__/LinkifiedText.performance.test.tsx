import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import LinkifiedText from '../LinkifiedText';
import { splitOnUrls } from '../../lib/url';
import { splitChatMentions } from '../../lib/chatMentions';
import { addChatMentionReference, splitIdentityMentions } from '../../lib/chatMentionIdentity';

jest.mock('../../lib/url', () => ({ ...jest.requireActual('../../lib/url'), splitOnUrls: jest.fn(jest.requireActual('../../lib/url').splitOnUrls) }));
jest.mock('../../lib/chatMentions', () => ({ ...jest.requireActual('../../lib/chatMentions'), splitChatMentions: jest.fn(jest.requireActual('../../lib/chatMentions').splitChatMentions) }));
jest.mock('../../lib/chatMentionIdentity', () => ({ ...jest.requireActual('../../lib/chatMentionIdentity'), splitIdentityMentions: jest.fn(jest.requireActual('../../lib/chatMentionIdentity').splitIdentityMentions) }));
let tree: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => tree?.unmount()));

it('does not reparse unchanged text during parent updates and still uses the latest profile action', () => {
  const text = '@Alex see https://example.test/a-long-destination-that-still-opens-in-full';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const document = addChatMentionReference(text, null, userId, 'Alex', 0);
  const original = jest.fn(), latest = jest.fn();
  act(() => { tree = create(<LinkifiedText text={text} mentionDocument={document} onMentionPress={original}/>); });
  const calls = [splitIdentityMentions, splitOnUrls, splitChatMentions].map(fn => (fn as jest.Mock).mock.calls.length);
  for (let i = 0; i < 25; i++) {
    act(() => tree.update(<LinkifiedText text={text} mentionDocument={document} onMentionPress={latest} fullUrls/>));
  }
  expect([splitIdentityMentions, splitOnUrls, splitChatMentions].map(fn => (fn as jest.Mock).mock.calls.length)).toEqual(calls);
  const profile = tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'link')!;
  act(() => profile.props.onPress({ stopPropagation: jest.fn() }));
  expect(latest).toHaveBeenCalledWith(userId);
  expect(original).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(Text).some(node => node.props.children === text.slice(10))).toBe(true);
});

it('updates highlighting when known names change, text changes, or authoritative identity is cleared', () => {
  const text = '@Alex hello', names = new Set(['Sam']);
  act(() => { tree = create(<LinkifiedText text={text} mentionNames={names}/>); });
  const initial = (splitChatMentions as jest.Mock).mock.calls.length;
  act(() => tree.update(<LinkifiedText text={text} mentionNames={new Set(['Alex'])}/>));
  expect((splitChatMentions as jest.Mock).mock.calls.length).toBeGreaterThan(initial);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === '@Alex')).toBe(true);
  act(() => tree.update(<LinkifiedText text="hello Sam" mentionNames={names}/>));
  expect(tree.root.findAllByType(Text).some(node => node.props.children === '@Alex')).toBe(false);
  const document = addChatMentionReference(text, null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alex', 0);
  const onMentionPress = jest.fn();
  act(() => tree.update(<LinkifiedText text={text} mentionDocument={document} onMentionPress={onMentionPress}/>));
  expect(tree.root.findAllByType(Text).filter(node => node.props.accessibilityRole === 'link')).toHaveLength(1);
  act(() => tree.update(<LinkifiedText text={text} mentionDocument={null} onMentionPress={onMentionPress}/>));
  expect(tree.root.findAllByType(Text).filter(node => node.props.accessibilityRole === 'link')).toHaveLength(0);
});
