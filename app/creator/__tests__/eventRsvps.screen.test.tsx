import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import Screen from '../event-rsvps';
import { RsvpAccessDenied } from '../../../lib/eventRsvpGuests';
const mockRead = jest.fn(), mockBack = jest.fn(), mockReplace = jest.fn();
let mockCurrent = true;
const mockScope = { userId: 'owner', isCurrent: () => mockCurrent };
jest.mock('../../../lib/eventRsvpGuests', () => ({ getEventRsvpGuests: (...args: any[]) => mockRead(...args), RsvpAccessDenied: class extends Error {} }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: null } }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'event', pageId: 'page' }), router: { canGoBack: () => false, back: () => mockBack(), replace: (...args: any[]) => mockReplace(...args) } }));
jest.mock('../../../components/creator/pages/PageFrame', () => {
 const React = require('react'), { View, Text, TouchableOpacity } = require('react-native');
 return { pageStyles: {}, PageFrame: ({ children, onBack }: any) => <View><TouchableOpacity accessibilityLabel="Back" onPress={onBack}/>{children}</View>, PageAction: ({ title, onPress, disabled }: any) => <TouchableOpacity accessibilityLabel={title} disabled={disabled} onPress={onPress}><Text>{title}</Text></TouchableOpacity> };
});
let tree: ReactTestRenderer;
const data = { title: 'Sunday supper', guests: [{ id: 'juniper', name: 'Juniper', photo: null }, { id: 'cedar', name: 'Cedar', photo: null }] };
const copy = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAll(node => typeof node.type !== 'string' && node.props.accessibilityLabel === label)[0];
async function mount() { await act(async () => { tree = create(<Screen/>); }); }
beforeEach(() => { jest.clearAllMocks(); mockCurrent = true; mockRead.mockReset().mockResolvedValue(data); });
afterEach(() => { act(() => tree.unmount()); });
it('shows real guests, searches names, clears a no-match search and returns to the same event', async () => {
 await mount(); expect(copy()).toContain('2'); expect(copy()).toContain('Juniper');
 const input = button('Search RSVP guests'); act(() => input.props.onChangeText('not here')); expect(copy()).toContain('No guests match'); expect(copy()).not.toContain('Juniper');
 act(() => button('Clear search').props.onPress()); expect(copy()).toContain('Juniper'); act(() => button('Back').props.onPress()); expect(mockReplace).toHaveBeenCalledWith('/creator/event-summary?id=event&pageId=page');
});
it('keeps an empty guest list distinct from an initial read failure', async () => {
 mockRead.mockRejectedValueOnce(Error('offline')); await mount(); expect(copy()).toContain('Couldn’t load RSVPs'); expect(copy()).not.toContain('0 people');
 mockRead.mockResolvedValue({title:'Sunday supper',guests:[]});await act(async()=>button('Try again').props.onPress());expect(copy()).toContain('People will appear here');expect(button('Event overview')).toBeTruthy();
});
it('does not show old names after a confirmed permission denial on refresh', async () => {
 await mount(); mockRead.mockRejectedValue(new RsvpAccessDenied());
 const frame = tree.root.findByType(require('../../../components/creator/pages/PageFrame').PageFrame);
 await act(async () => frame.props.onRefresh()); expect(copy()).not.toContain('Juniper'); expect(copy()).toContain('RSVPs unavailable');
});
it('retires a pending request after the account leaves', async () => {
 let finish!: (value: any) => void; mockRead.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));await mount();expect(copy()).toContain('Loading RSVPs');mockCurrent=false;
 await act(async()=>finish(data));expect(copy()).not.toContain('Juniper');
});
