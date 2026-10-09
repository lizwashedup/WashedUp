jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'creator', epoch: 1, isLoading: false, error: null, isCurrent: () => true, retry: jest.fn() }) }));
// Profile header owns its query provider; this suite exercises the surrounding journey.
jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRefetch = jest.fn(async () => ({}));
let mockQueries: Record<string, any>;
jest.mock('@tanstack/react-query', () => ({useQuery: ({queryKey}: any) => mockQueries[queryKey[0]]}));
jest.mock('expo-router', () => ({router:{push:jest.fn(),replace:jest.fn()},Redirect:()=>null}));
jest.mock('../../../lib/creatorMode', () => ({...jest.requireActual('../../../lib/creatorMode')}));
jest.mock('../../../lib/selectedCommunity', () => ({useLedCommunity:()=>null}));
jest.mock('../../../lib/communityChat', () => ({}));
jest.mock('../../../lib/supabase', () => ({supabase:{}}));
jest.mock('../../../lib/ticketAttendees', () => ({countAttendees:()=>({sold:0,checkedIn:0})}));
jest.mock('../../../lib/eventRsvp', () => ({}));
jest.mock('../../../lib/workspaceContext', () => ({eventBelongsToWorkspace:()=>true}));
jest.mock('../../../hooks/useNetworkStatus', () => ({useNetworkStatus:()=>({online:true})}));
jest.mock('../WorkspaceSwitcher', () => ({WorkspaceSwitcher:()=>null}));
jest.mock('../CommunitySwitcher', () => ({CommunitySwitcher:()=>null}));
jest.mock('../CreatorActionFill', () => ({CreatorActionFill:()=>null}));
jest.mock('../../events/EventMediaImage', () => ({EventMediaImage:()=>null}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
import Screen from '../../../app/(creator)/today';
let tree: ReactTestRenderer;
const result=(data:unknown)=>({data,isFetchedAfterMount:true,isError:false,isLoading:false,isFetching:false,isRefetching:false,refetch:mockRefetch});

beforeEach(()=>{jest.clearAllMocks();mockQueries={'creator-access':result({hasLeaderGrant:true,hasEventHostGrant:false,ledCommunities:[],isRevoked:false}),'creator-members':result([]),'creator-broadcasts':result([]),'creator-events':result([]),'creator-rooms':result([]),'creator-today-attendees':result([]),'creator-today-rsvp-count':result(0)};});
afterEach(()=>act(()=>tree?.unmount()));
it('an existing approved leader with no community reaches the real first-community setup action',async()=>{
 await act(async()=>{tree=create(<Screen/>);});
 const action=tree.root.findAll(node=>typeof node.props.onPress==='function'&&node.findAll(child=>child.props.children==='start your community').length>0)[0];
 expect(action).toBeDefined();act(()=>action.props.onPress());expect(require('expo-router').router.push).toHaveBeenCalledWith('/creator/setup-community');
 expect(JSON.stringify(tree.toJSON())).toContain('your application was approved');
});
