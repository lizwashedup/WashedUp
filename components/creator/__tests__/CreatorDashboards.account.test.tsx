import React from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Organizer from '../../../app/(creator)/organizer-home';
import Today from '../../../app/(creator)/today';

let mockUser = 'alice';
let mockWait: Promise<void>;
const mockPush = jest.fn();
const mockCommunity = { id: 'shared', role: 'leader', status: 'active', name: 'Shared community' };
jest.mock('../../../hooks/useObservedUser', () => ({
  useObservedUser: () => {
    const id = mockUser;
    return { viewerId: id, epoch: 1, isLoading: false, error: null, isCurrent: () => mockUser === id };
  },
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: mockUser } } }) } } }));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useRouter: () => ({ push: mockPush }), useFocusEffect: jest.fn(), Redirect: () => null,
}));
jest.mock('../../../lib/creatorMode', () => ({
  getCreatorAccess: async () => ({ hasEventHostGrant: true, hasLeaderGrant: true, ledCommunities: [mockCommunity] }),
  getCreatorEvents: async (ids: string[], user: string) => {
    if (user === 'bob') await mockWait;
    return [{ id: user, title: user + ' event', community_id: ids[0] ?? null,
      status: ids.length ? 'Live' : 'Draft', event_date: ids.length ? '2099-01-01' : null, tiers: [] }];
  },
  isLeaderAccess: () => true, isAdminTierRole: () => true, getCommunityMembers: async () => [],
  getBroadcasts: async () => [],
}));
jest.mock('../../../lib/selectedCommunity', () => ({useLedCommunity: (access: any) => access?.ledCommunities[0] ?? null}));
jest.mock('../../../lib/organizerProfile', () => ({getMyOrganizerProfile: async () => {
  const id = mockUser; if (id === 'bob') await mockWait; return { display_name: id + ' studio' };
}}));
jest.mock('../../../lib/organizerFollows', () => ({ getFollowerCount: jest.fn(async () => null) }));
jest.mock('../../../lib/ticketing', () => ({ getTiers: async () => [], getFailedPayouts: async () => [] }));
jest.mock('../../../lib/communityChat', () => ({getCommunityRooms: async () => []}));
jest.mock('../../../lib/eventRsvp', () => ({getRsvpCount: async () => 0}));
jest.mock('../../../lib/ticketAttendees', () => ({getEventAttendees: async () => [], countAttendees: () => ({sold: 0, checkedIn: 0})}));
jest.mock('../../../hooks/useNetworkStatus', () => ({useNetworkStatus: () => ({online:true})}));
jest.mock('../OrganizationDailyActions', () => ({ OrganizationDailyActions: () => null }));
jest.mock('../CommunityDailyActions', () => ({ CommunityDailyActions: () => null }));
jest.mock('../CreatorActionFill', () => ({CreatorActionFill: () => null}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({useAfterglowFonts: () => ({fonts:require('../../../constants/Typography').CreatorFonts})}));

const textOf = (n:any):string => typeof n === 'string' ? n : (Array.isArray(n) ? n : n?.children ?? []).map(textOf).join(' ');
const settle = () => act(async () => { await new Promise(done => setTimeout(done, 35)); });

it.each([['organization', Organizer], ['community', Today]] as const)(
  'loads the current creator’s %s dashboard before offering their event destination', async (kind, Screen) => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    let release!: () => void;
    mockWait = new Promise<void>(done => {release = done;});
    const ui = () => <QueryClientProvider client={client}><Screen key={mockUser}/></QueryClientProvider>;
    let tree!: ReactTestRenderer;
    try {
      mockUser = 'alice'; await act(async () => {tree = create(ui());}); await settle(); await settle();
      expect(textOf(tree.toJSON())).toContain('alice event');
      mockUser = 'bob'; await act(async () => tree.update(ui())); await settle(); await settle();
      expect(textOf(tree.toJSON())).not.toContain('alice');
      release(); await settle(); await settle();
      expect(textOf(tree.toJSON())).toContain('bob event');
      if (kind === 'organization') {
        expect(textOf(tree.toJSON())).toContain('bob studio');
        expect(require('../../../lib/organizerFollows').getFollowerCount).toHaveBeenCalledWith({kind:'organizer',id:'bob'});
      }
      const action = tree.root.findAll(n => typeof n.props.onPress === 'function' &&
        (kind === 'organization' ? n.props.accessibilityLabel === 'Continue draft: bob event' :
          n.props.accessibilityRole === 'button' && n.findAll(child => child.props.children === 'bob event').length > 0))[0];
      act(() => action.props.onPress());
      expect(mockPush).toHaveBeenLastCalledWith(kind === 'organization' ? '/creator/event-form?id=bob' : '/(tabs)/friends/manage/(tools)/events');
    } finally {
      release(); act(() => tree?.unmount()); client.clear();
    }
  },
);
