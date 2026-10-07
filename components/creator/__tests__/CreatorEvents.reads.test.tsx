import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPush=jest.fn();
const mockRefetch=jest.fn(async()=>({}));
let mockEvents:any;
jest.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:any)=>queryKey[0]==='creator-events-tab'?mockEvents:{data:queryKey[0]==='creator-access'?{}:[]},useQueryClient:()=>({invalidateQueries:jest.fn()}),useMutation:()=>({mutate:jest.fn(),isPending:false,isError:false})}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('../../../lib/creatorMode',()=>({}));
jest.mock('../../../lib/creatorEvents',()=>({}));
jest.mock('../../../lib/creatorPageEventTemplateLibrary',()=>({}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:null,account:{isLoading:false}})}));
jest.mock('../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:()=>({loading:false,data:[],refresh:jest.fn()})}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:false,EVENT_SUMMARY_ENABLED:true}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>({id:'community'})}));
jest.mock('../../../lib/workspaceContext',()=>({useWorkspace:()=> 'community',eventBelongsToWorkspace:()=>true}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../WorkspaceSwitcher',()=>({WorkspaceSwitcher:()=>null}));
jest.mock('../CommunitySwitcher',()=>({CommunitySwitcher:()=>null}));
jest.mock('../CreatorActionFill',()=>({CreatorActionFill:()=>null}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
import Screen from '../../../app/(creator)/events';
let tree:ReactTestRenderer;
const visibleText=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(visibleText).join(''):(node?.children??[]).map(visibleText).join('');
const render=async()=>{await act(async()=>{tree=create(<Screen/>)});return visibleText(tree.toJSON());};
beforeEach(()=>{jest.clearAllMocks();mockEvents={data:[],isPending:false,isError:false,isFetching:false,isRefetching:false,refetch:mockRefetch};});
afterEach(()=>act(()=>tree?.unmount()));
it('never reports no attention after an event read fails and retries the same query',async()=>{
 mockEvents.isError=true;expect(await render()).toContain('Events unavailable');expect(visibleText(tree.toJSON())).not.toContain('Nothing needs your attention');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry events'&&typeof n.props.onPress==='function')[0];await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
 mockEvents.isError=false;await act(async()=>tree.update(<Screen/>));expect(visibleText(tree.toJSON())).toContain('Nothing needs your attention');
});
it('keeps a disabled pending query distinct from empty events',async()=>{mockEvents.isPending=true;expect(await render()).toContain('Loading your events');expect(visibleText(tree.toJSON())).not.toContain('Nothing needs your attention');});
it('leaves the independent template library reachable when events fail',async()=>{
 mockEvents.isError=true;await render();const tab=tree.root.findAll(n=>n.props.accessibilityLabel==='Templates'&&typeof n.props.onPress==='function')[0];await act(async()=>tab.props.onPress());expect(visibleText(tree.toJSON())).not.toContain('Events unavailable');expect(visibleText(tree.toJSON())).toContain('Save an event as a template');
});
it('retains cached event content alongside a refresh error',async()=>{
 mockEvents.isError=true;mockEvents.data=[{id:'one',title:'A saved evening gathering',status:'Draft',event_date:null,tiers:[]}];await render();const tab=tree.root.findAll(n=>n.props.accessibilityLabel==='Drafts'&&typeof n.props.onPress==='function')[0];await act(async()=>tab.props.onPress());const text=visibleText(tree.toJSON());expect(text).toContain('A saved evening gathering');expect(text).toContain('Showing saved events.');
});

it('keeps all five event controls individually reachable and sends each to its exact event', async()=>{
 mockEvents.data=[{id:'one',title:'Saved gathering',status:'Live',event_date:'2099-09-19',tiers:[],goingCount:2,ticketsSold:0}];
 await render();
 const tab=tree.root.findAll(n=>n.props.accessibilityLabel==='Next event'&&typeof n.props.onPress==='function')[0];
 await act(async()=>tab.props.onPress());
 for(const [label,route] of [
  ['Summary for Saved gathering','event-summary'],['Tickets for Saved gathering','tickets'],
  ["Who's coming to Saved gathering",'attendees'],['Check in for Saved gathering','check-in'],['Money for Saved gathering','event-money'],
 ]){
  const button=tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
  expect(button.props.accessibilityRole).toBe('button');
  await act(async()=>button.props.onPress());
  expect(mockPush).toHaveBeenLastCalledWith(`/creator/${route}?id=one`);
 }
});
