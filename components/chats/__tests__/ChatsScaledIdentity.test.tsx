import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatInboxHeading } from '../ChatInboxHeading';
import { ChatInboxRow } from '../ChatInboxRow';
import ProfileButton from '../../ProfileButton';
import { AfterglowFonts } from '../../../constants/Typography';
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'profile-photo' ? 'https://example.test/profile.jpg' : queryKey[0] === 'inbox-count' ? 3 : 'viewer', refetch: jest.fn() }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../InboxModal', () => () => null);
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts }) }));
let tree: ReactTestRenderer;
beforeEach(() => { mockFontScale = 1; });
afterEach(() => { act(() => tree?.unmount()); });
it.each(['Chats', 'Profile', 'Sunday people', '9:46 PM', 'A Sunday walk', 2, 'Sunday circle', 'Chat stays open'])('remeasures %s on mounted scaling without replacing rows, navigation or the profile image', target => {
  const open = jest.fn(), options = jest.fn();
  const render = () => <><ChatInboxHeading fonts={AfterglowFonts}><ProfileButton /></ChatInboxHeading>
    <ChatInboxRow identity="circle-one" title="Sunday people" preview="A Sunday walk" timestamp="9:46 PM" unread={2} metadata="Sunday circle" lifecycle="Chat stays open"
      fonts={{ ...AfterglowFonts }} onPress={open} onLongPress={options} /></>;
  act(() => { tree = create(render()); });
  const label = () => tree.root.findAllByType(Text).find(node => node.props.children === target)!;
  const profileImage = tree.root.findByType(Image);
  const buttons = tree.root.findAllByType(TouchableOpacity);
  let previous = label();
  for (const scale of [2, 1]) {
    mockFontScale = scale; act(() => tree.update(render()));
    expect(label()).not.toBe(previous); previous = label();
    expect(tree.root.findByType(Image)).toBe(profileImage);
    expect(tree.root.findAllByType(TouchableOpacity)).toEqual(buttons);
  }
  const chat = buttons.find(node => node.props.accessibilityLabel?.startsWith('Sunday people,'))!;
  expect(chat.props.accessibilityLabel).toContain('2 unread messages');
  act(() => { chat.props.onPress(); chat.props.onLongPress(); });
  expect(open).toHaveBeenCalledTimes(1); expect(options).toHaveBeenCalledTimes(1);
  expect(buttons.find(node => node.props.accessibilityLabel === 'Profile')).toBeDefined();
  expect(buttons.find(node => node.props.accessibilityLabel === 'Inbox')).toBeDefined();
});
