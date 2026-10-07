import React from 'react';
import { TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CommunityChatHub } from '../CommunityChatHub';
import type { CommunityChatRowData } from '../../../lib/communityChat';
import { projectCommunityChatInbox } from '../../../lib/communityChatInbox';

// Identity/navigation coverage; actual font loading is checked in the browser.
jest.mock('../../../hooks/useAfterglowFonts', () => ({
  useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts, loaded: true, error: null }),
}));

const main: CommunityChatRowData = {
  key: 'community-sunset', kind: 'community', targetId: 'sunset', communityId: 'sunset',
  title: 'Sunset Club LA', roomName: 'Original conversation', secondary: null, preview: 'Hello!',
  lastAt: '2026-09-12T18:00:00Z', unread: 2, accent: null, image: null, eventId: null,
};
const room: CommunityChatRowData = {
  ...main, key: 'room-main', kind: 'room', targetId: 'main-room', title: 'After Glow', secondary: main.title, unread: 3,
};
const event: CommunityChatRowData = {
  ...room, key: 'room-volleyball', targetId: 'event-room', title: 'Sunset volleyball', eventId: 'volleyball', unread: 1,
};

function setup() {
  const onBack = jest.fn(), onViewCommunity = jest.fn(), onOpenRoom = jest.fn(), onRefresh = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(<CommunityChatHub
    group={projectCommunityChatInbox([main, room, event]).communities[0]}
    {...{ onBack, onViewCommunity, onOpenRoom, onRefresh }} refreshing={false}
  />); });
  const press = (label: string) => {
    const control = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel?.startsWith(label));
    expect(control).toBeDefined();
    act(() => control!.props.onPress());
  };
  return { tree: tree!, press, onBack, onViewCommunity, onOpenRoom, onRefresh };
}

it('opens no room and changes no membership or read state when the directory mounts', () => {
  const fixture = setup();
  expect(fixture.onOpenRoom).not.toHaveBeenCalled();
  expect(fixture.onViewCommunity).not.toHaveBeenCalled();
  expect(fixture.onRefresh).not.toHaveBeenCalled();
  expect(fixture.tree.toJSON()).toBeTruthy();
  act(() => fixture.tree.unmount());
});

it('preserves original stream names and callback identities instead of inventing an Intros history', () => {
  const fixture = setup();
  fixture.press('Original conversation, 2 unread messages');
  expect(fixture.onOpenRoom).toHaveBeenLastCalledWith(main);
  fixture.press('After Glow, 3 unread messages');
  expect(fixture.onOpenRoom).toHaveBeenLastCalledWith(room);
  fixture.press('Sunset volleyball, 1 unread message');
  expect(fixture.onOpenRoom).toHaveBeenLastCalledWith(event);
  act(() => fixture.tree.unmount());
});

it('keeps community navigation and return separate from opening or joining a room', () => {
  const fixture = setup();
  fixture.press('View Sunset Club LA community');
  fixture.press('Back to Chats');
  expect(fixture.onViewCommunity).toHaveBeenCalledTimes(1);
  expect(fixture.onBack).toHaveBeenCalledTimes(1);
  expect(fixture.onOpenRoom).not.toHaveBeenCalled();
  act(() => fixture.tree.unmount());
});

it('offers group discovery for a mapped community without changing existing room callbacks', () => {
  const onBrowseGroups = jest.fn(); let tree!: ReactTestRenderer;
  act(() => { tree = create(<CommunityChatHub group={projectCommunityChatInbox([{ ...main, roomRole: 'main' }, { ...room, roomRole: 'intros' }]).communities[0]}
    onBack={jest.fn()} onViewCommunity={jest.fn()} onOpenRoom={jest.fn()} onRefresh={jest.fn()} refreshing={false} onBrowseGroups={onBrowseGroups} />); });
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Browse community groups');
  expect(button).toBeDefined();act(() => button!.props.onPress());expect(onBrowseGroups).toHaveBeenCalledTimes(1);act(() => tree.unmount());
});

it('keeps effective room state without notification controls, muting event shortcuts or changing unread',()=>{
 const notifications:any={data:{muted:true,version:1},ready:true,busy:false,pending:null,error:null,change:jest.fn()};let tree!:ReactTestRenderer;
 act(()=>{tree=create(<CommunityChatHub group={projectCommunityChatInbox([main,room,event]).communities[0]} notifications={notifications} onBack={jest.fn()} onViewCommunity={jest.fn()} onOpenRoom={jest.fn()} onRefresh={jest.fn()} refreshing={false}/>);});
 const buttons=tree.root.findAllByType(TouchableOpacity);const persistent=buttons.find(n=>n.props.accessibilityLabel?.startsWith('Original conversation,'));const attendee=buttons.find(n=>n.props.accessibilityLabel?.startsWith('Sunset volleyball,'));
 expect(persistent?.props.accessibilityLabel).toContain('All community chats muted');expect(persistent?.props.accessibilityLabel).toContain('2 unread messages');expect(attendee?.props.accessibilityLabel).not.toContain('muted');expect(notifications.change).not.toHaveBeenCalled();
 expect(buttons.find(n=>n.props.accessibilityLabel==='Unmute all community chats')).toBeUndefined();
 expect(buttons.find(n=>n.props.accessibilityLabel==='Mute all community chats')).toBeUndefined();
 expect(notifications.change).not.toHaveBeenCalled();act(()=>tree.unmount());
});
