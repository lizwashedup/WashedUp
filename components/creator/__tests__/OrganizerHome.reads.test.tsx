import React from 'react';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
const mockRefetch=jest.fn(async()=>({}));let mockQueries:Record<string,any>;
jest.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:any)=>mockQueries[queryKey[0]]}));
jest.mock('expo-router',()=>({useRouter:()=>({push:jest.fn()})}));
jest.mock('../../../lib/creatorMode',()=>({}));
jest.mock('../../../lib/organizerProfile',()=>({}));
jest.mock('../../../lib/organizerFollows',()=>({}));
jest.mock('../../../lib/ticketing',()=>({isLowInventory:(left:number,cap:number)=>cap>0&&left/cap<=.1}));
jest.mock('../../../lib/ticketAttendees',()=>({countAttendees:(rows:any[])=>({sold:rows.length,checkedIn:rows.length?1:0})}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/workspaceContext',()=>({eventBelongsToWorkspace:()=>true}));
jest.mock('../WorkspaceSwitcher',()=>({WorkspaceSwitcher:()=>null}));
jest.mock('../CreatorActionFill',()=>({CreatorActionFill:()=>null}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
import Screen from '../../../app/(creator)/organizer-home';
let tree:ReactTestRenderer;
const result=(data:unknown)=>({data,isError:false,isPending:false,isFetching:false,refetch:mockRefetch});
const visibleText=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(visibleText).join(''):(node?.children??[]).map(visibleText).join('');
const render=async()=>{await act(async()=>{tree=create(<Screen/>)});return visibleText(tree.toJSON());};
beforeEach(()=>{jest.clearAllMocks();mockQueries={
 'my-user-id':result('user'),'creator-access':result({}),
 'organizer-profile':result({display_name:'Coastal Evenings'}),
 'creator-events-tab':result([{id:'event',title:'Sunday supper',status:'Live',event_date:new Date(Date.now()+86400000).toISOString(),tiers:[]}]),
 'organizer-home-tiers':result([{quantity_cap:20,status:'on_sale'}]),
 'organizer-home-attendees':result([{},{}]),'organizer-follower-count':result(null),'organizer-home-failed-payouts':result([])};});
afterEach(()=>act(()=>tree?.unmount()));
it('does not claim an empty calendar after a failed event read',async()=>{
 mockQueries['creator-events-tab']={...result(undefined),isError:true};const text=await render();expect(text).toContain('Events unavailable');expect(text).not.toContain('nothing on the calendar');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry events'&&typeof n.props.onPress==='function')[0];await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('preserves the disabled pending event guard',async()=>{mockQueries['creator-events-tab']={...result(undefined),isPending:true};expect(await render()).not.toContain('nothing on the calendar');});
it('does not invent ticket or check-in zeroes when attendees fail and retries both inventory reads',async()=>{
 mockQueries['organizer-home-attendees']={...result(undefined),isError:true};const text=await render();expect(text).toContain('Ticket counts unavailable');expect(text).toContain('Check-in count unavailable');expect(text).not.toContain('0 tickets sold');expect(text).not.toContain('0 of 0 checked in');
 const retry=tree.root.findAll(n=>n.props.accessibilityLabel==='Retry ticket counts'&&typeof n.props.onPress==='function')[0];await act(async()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(2);
});
it('suppresses scarcity and totals from a failed cached inventory read',async()=>{
 mockQueries['organizer-home-tiers']={...result([{quantity_cap:2,status:'on_sale'}]),isError:true};const text=await render();expect(text).not.toContain('almost sold out');expect(text).not.toContain('2 of 2 tickets sold');expect(text).toContain('1 of 2 checked in');
});
it('does not propose organization setup after a failed profile read',async()=>{
 mockQueries['organizer-profile']={...result(undefined),isError:true};const text=await render();expect(text).toContain('Organization details unavailable');expect(text).not.toContain('set it up. takes a minute.');expect(tree.root.findAll(n=>n.props.accessibilityLabel==='organization setup needed')).toHaveLength(0);
});
it('exposes failed payout status without claiming a resolved status',async()=>{
 mockQueries['organizer-home-failed-payouts']={...result(undefined),isError:true};expect(await render()).toContain('Payout status unavailable');
});
it('retains confirmed counts and original organization capitalization',async()=>{
 const text=await render();expect(text).toContain('Coastal Evenings');expect(text).toContain('2 of 20 tickets sold');expect(text).toContain('1 of 2 checked in');expect(text).not.toContain('unavailable');
});
it('keeps confirmed empty setup and event creation available',async()=>{
 mockQueries['organizer-profile']=result(null);mockQueries['creator-events-tab']=result([]);const text=await render();expect(text).toContain('nothing on the calendar');expect(text).toContain('set it up. takes a minute.');
});

it('retains a saved draft without showing the empty calendar invitation',async()=>{
 mockQueries['creator-events-tab']=result([{id:'draft',title:'A saved supper',status:'Draft',event_date:null,tiers:[{status:'draft'}]}]);
 const text=await render();expect(text).toContain('A saved supper');expect(text).toContain('draft saved');expect(text).toContain('your ticket is saved. finish making it sellable.');expect(text).not.toContain('nothing on the calendar');
});
