import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockRefetch = jest.fn(async () => ({}));
let mockQueries: Record<string, any>;
jest.mock('@tanstack/react-query', () => ({useQuery: ({queryKey}: any) => mockQueries[queryKey[0]]}));
jest.mock('expo-router', () => ({router:{push:jest.fn(),replace:jest.fn()},Redirect:()=>null}));
jest.mock('../../../lib/creatorMode', () => ({isLeaderAccess:()=>true,creatorLandingRoute:()=>'/'}));
jest.mock('../../../lib/selectedCommunity', () => ({useLedCommunity:()=>({id:'community',name:'Our Sunday Table'})}));
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
const result=(data:unknown)=>({data,isError:false,isLoading:false,isFetching:false,isRefetching:false,refetch:mockRefetch});
beforeEach(()=>{
 jest.clearAllMocks();
 mockQueries={
 'creator-access':result({hasLeaderGrant:true,ledCommunities:[{id:'community'}]}),
 'creator-members':result([{status:'active'}]),'creator-broadcasts':result([]),
 'creator-events':result([{id:'event',title:'Sunday walk',status:'Live',event_date:new Date(Date.now()+86400000).toISOString()}]),
 'creator-rooms':result([]),'creator-today-attendees':result([]),'creator-today-rsvp-count':result(5)};
});
afterEach(()=>act(()=>tree?.unmount()));
const visibleText=(node:any):string => typeof node==='string' ? node : Array.isArray(node) ? node.map(visibleText).join('') : (node?.children ?? []).map(visibleText).join('');
const render=async()=>{await act(async()=>{tree=create(<Screen/>);});return visibleText(tree.toJSON());};
it('keeps a failed member read distinct from an empty community and offers retry',async()=>{
 mockQueries['creator-members']={...result(undefined),isError:true};
 const text=await render();expect(text).toContain('Members unavailable');expect(text).not.toContain('no join requests waiting');expect(text).not.toContain('0 members');expect(text).toContain('Sunday walk');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry members'&&typeof n.props.onPress==='function')[0];
 await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
 mockQueries['creator-members']=result([{status:'active'}]);await act(async()=>tree.update(<Screen/>));expect(visibleText(tree.toJSON())).not.toContain('Members unavailable');
});
it('does not present empty member facts while loading',async()=>{
 mockQueries['creator-members']={...result(undefined),isLoading:true};const text=await render();expect(text).toContain('Loading members');expect(text).not.toContain('no join requests waiting');
});
it.each([['creator-events','Events','Plan your next gathering'],['creator-broadcasts','Updates','say something to your people'],['creator-rooms','Chat spaces','unused']])('exposes failed %s reads without inventing an empty state',async(key,label,empty)=>{
 mockQueries[key]={...result(undefined),isError:true};const text=await render();expect(text).toContain(`${label} unavailable`);if(empty!=='unused')expect(text).not.toContain(empty);
});
it('does not show sales or RSVP totals after either attendance read fails',async()=>{
 mockQueries['creator-today-attendees']={...result(undefined),isError:true};const text=await render();expect(text).toContain('Attendance unavailable');expect(text).not.toContain('5 going');expect(text).not.toContain('0 sold');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry attendance'&&typeof n.props.onPress==='function')[0];await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(2);
});
it('retains the confirmed empty and populated presentation when reads succeed',async()=>{
 const text=await render();expect(text).toContain('no join requests waiting');expect(text).toContain('1 member so far');expect(text).toContain('5 going');expect(text).not.toContain('unavailable');
});
