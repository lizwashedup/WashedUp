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
it.each([['creator-broadcasts','Sent updates'],['creator-rooms','Chat spaces']])('distinguishes failed %s from empty and retries without dropping a draft',async(key,label)=>{
 mockQueries[key]={...result(undefined),isError:true};
 const text=await render();expect(text).toContain(`${label} unavailable`);if(key==='creator-rooms')expect(text).not.toContain('No chat spaces yet.');
 const input=tree.root.findAll(n=>n.props.accessibilityLabel==='Broadcast message to your members'&&typeof n.props.onChangeText==='function')[0];
 await act(async()=>input.props.onChangeText('Keep this unsent update'));
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel===`Retry ${label.toLowerCase()}`&&typeof n.props.onPress==='function')[0];
 await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
 mockQueries[key]=result([]);await act(async()=>tree.update(<Screen/>));
 expect(visibleText(tree.toJSON())).not.toContain(`${label} unavailable`);
 expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Broadcast message to your members'&&typeof n.props.onChangeText==='function')[0].props.value).toBe('Keep this unsent update');
});
it('does not leave a failed audience read looking pending',async()=>{
 mockQueries['creator-broadcast-audience']={...result(undefined),isError:true};const text=await render();expect(text).toContain('Audience unavailable');expect(text).not.toContain('checking your community');expect(text).not.toContain('No active members');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry audience'&&typeof n.props.onPress==='function')[0];await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('keeps loading distinct from confirmed empty',async()=>{
 for(const key of ['creator-broadcasts','creator-rooms'])mockQueries[key]={...result(undefined),isLoading:true};
 const text=await render();expect(text).toContain('Loading sent updates');expect(text).toContain('Loading chat spaces');expect(text).not.toContain('No chat spaces yet.');
});
it('retains cached content during a background refresh failure',async()=>{
 mockQueries['creator-broadcasts']={...result([{id:'one',body:'Bring a picnic',created_at:'2026-09-18T17:00:00Z'}]),isError:true};
 const text=await render();expect(text).toContain('Sent updates unavailable');expect(text).toContain('Bring a picnic');
});
it('shows confirmed zero audience and empty rooms honestly',async()=>{
 mockQueries['creator-broadcast-audience']=result(0);const text=await render();expect(text).toContain('No active members yet.');expect(text).toContain('No chat spaces yet.');expect(text).not.toContain('unavailable');
});
