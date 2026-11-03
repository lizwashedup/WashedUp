import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRefetch = jest.fn(async () => ({}));
let mockQueries: Record<string, any>;
jest.mock('@tanstack/react-query', () => ({useQuery: ({queryKey}: any) => mockQueries[queryKey[0]],useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('expo-router', () => ({useRouter:()=>({push:jest.fn(),replace:jest.fn()}),Redirect:()=>null}));
jest.mock('../../../lib/creatorMode', () => ({isLeaderAccess:()=>true,isAdminTierRole:()=>true,creatorLandingRoute:()=> '/',buildCommunityPublicLink:()=> 'https://example.test/community/sunday'}));
jest.mock('../../../lib/selectedCommunity', () => ({useLedCommunity:()=>({id:'community',name:'Our Sunday Table',status:'active',role:'leader'})}));
jest.mock('../../../lib/communityChat', () => ({}));
jest.mock('../../../lib/haptics', () => ({hapticSuccess:jest.fn(),hapticWarning:jest.fn()}));
jest.mock('../WorkspaceSwitcher', () => ({WorkspaceSwitcher:()=>null}));
jest.mock('../CommunitySwitcher', () => ({CommunitySwitcher:()=>null}));
jest.mock('../CreatorActionFill', () => ({CreatorActionFill:()=>null}));
jest.mock('../../BrandedAlert', () => ({BrandedAlert:()=>null}));
jest.mock('../../keyboard/KeyboardDoneBar', () => ({KEYBOARD_DONE_ACCESSORY_ID:'done'}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
import Screen from '../../../app/(creator)/community';
let tree: ReactTestRenderer;
const result=(data:unknown)=>({data,isError:false,isLoading:false,isFetching:false,isRefetching:false,refetch:mockRefetch});
beforeEach(()=>{
 jest.clearAllMocks();mockQueries={
 'creator-access':result({hasLeaderGrant:true,ledCommunities:[{id:'community'}]}),
 'creator-broadcasts':result([]),'creator-broadcast-audience':result(24),'creator-rooms':result([])};
});
afterEach(()=>act(()=>tree?.unmount()));
const visibleText=(node:any):string => typeof node==='string' ? node : Array.isArray(node) ? node.map(visibleText).join('') : (node?.children ?? []).map(visibleText).join('');
const render=async()=>{await act(async()=>{tree=create(<Screen/>);});return visibleText(tree.toJSON());};
it('keeps failed chat-space reads distinct from empty and retries', async () => {
 mockQueries['creator-rooms']={...result(undefined),isError:true};
 const text=await render();expect(text).toContain('Chat spaces unavailable');expect(text).not.toContain('No chat spaces yet.');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry chat spaces'&&typeof n.props.onPress==='function')[0];
 await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('keeps loading distinct from confirmed empty',async()=>{
 mockQueries['creator-rooms']={...result(undefined),isLoading:true};
 const text=await render();expect(text).toContain('Loading chat spaces');expect(text).not.toContain('No chat spaces yet.');
});
it('retains cached rooms during a background refresh failure',async()=>{
 mockQueries['creator-rooms']={...result([{id:'one',name:'Sunday walkers'}]),isError:true};
 const text=await render();expect(text).toContain('Chat spaces unavailable');expect(text).toContain('Sunday walkers');
});
it('keeps page editing and joining in settings, with daily updates on their own screen',async()=>{
 const text=await render();expect(text).toContain('No chat spaces yet.');expect(text).toContain('Edit community');expect(text).toContain('Joining settings');
 expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Community update')).toHaveLength(0);
});
