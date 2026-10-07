import React from 'react';
import MenuCard from '../../../menu/MenuCard';
jest.mock('../../../menu/MenuCard',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../ProfileButton',()=>({__esModule:true,default:()=>null}));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn(), mockPublish = jest.fn(), mockCreate = jest.fn(), mockPush = jest.fn();
const mockPrepare=jest.fn(),mockClearAttempt=jest.fn();
let mockCurrent=true;
let mockAttempt:any=null;
const mockScope = { userId: 'creator', isCurrent: () => mockCurrent };
const mockFonts = { regular:'System',medium:'System',semibold:'System',display:'System' };
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:'creator',isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:mockFonts})}));
jest.mock('../../../../lib/creatorPageWorkspace',()=>({ ...jest.requireActual('../../../../lib/creatorPageWorkspace'), loadCreatorPageWorkspace:(...args:unknown[])=>mockLoad(...args) }));
jest.mock('../../../../lib/creatorPageReview',()=>({ ...jest.requireActual('../../../../lib/creatorPageReview'), publishCreatorPage:(...args:unknown[])=>mockPublish(...args),createCreatorPageEventDraft:(...args:unknown[])=>mockCreate(...args) }));
jest.mock('../../../../lib/creatorPageEventAttempt',()=>({readCreatorPageEventAttempt:async()=>mockAttempt,prepareCreatorPageEventAttempt:(...args:unknown[])=>mockPrepare(...args),clearCreatorPageEventAttempt:(...args:unknown[])=>mockClearAttempt(...args)}));
jest.mock('../../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../../lib/creatorEvents',()=>({EVENT_CATEGORIES:['community','music']}));
jest.mock('../../ApplyFormKit',()=>({ChoiceList:()=>null}));
jest.mock('expo-router',()=>({router:{push:(...args:unknown[])=>mockPush(...args),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import CreatorPageScreen from '../CreatorPageScreen';
import {EventMediaImage} from '../../../events/EventMediaImage';
import { PageAction } from '../PageFrame';
import { Dimensions, Text, TextInput, ScrollView } from 'react-native';
let page:any,tree:ReactTestRenderer;
const actions=()=>[...tree.root.findAllByType(PageAction),...tree.root.findAllByType(MenuCard).flatMap(menu=>menu.props.rows.map((row:any)=>({props:{title:row.label,onPress:row.onPress}})))];
const action=(title:string)=>actions().find(a=>a.props.title===title)!;
async function mount(){await act(async()=>{tree=create(<CreatorPageScreen pageId="page"/>);});}
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockAttempt=null;page={draft:{id:'page',page_kind:'community',version:1,page_data:{name:'Sunday Table'}},submissions:[{id:'review',revision:1,draft_version:1,status:'approved',page_snapshot:{name:'Sunday Table'}}],publication:null,events:[]};mockLoad.mockImplementation(async()=>page);mockPublish.mockImplementation(async()=>{page={...page,publication:{page_id:'page'}};});mockCreate.mockResolvedValue('saved-event');mockPrepare.mockResolvedValue({pageId:'page',eventId:'saved-event',title:'Event',category:'community'});mockClearAttempt.mockResolvedValue(undefined);});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});



it('continues to the existing editor using the confirmed saved event and page IDs',async()=>{
 await mount();act(()=>action('New event').props.onPress());
 act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>{action('Continue').props.onPress();});
 expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith('/creator/event-form?id=saved-event&pageId=page');
});
it('opens the published organization by page identity rather than the owner account',async()=>{
 page.draft.page_kind='organization';page.publication={page_id:'page'};await mount();
 act(()=>action('View public page').props.onPress());expect(mockPush).toHaveBeenCalledWith('/organization/page?identity=page');
});
it('opens updates for the same published organization and keeps communities separate',async()=>{
 await mount();expect(action('Page updates')).toBeUndefined();
 act(()=>tree.unmount());page.draft.page_kind='organization';page.publication={page_id:'page'};await mount();
 act(()=>action('Page updates').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-updates?id=page');
});

it('opens team tools only from the same explicitly published page',async()=>{
 await mount();expect(action('Page & team')).toBeUndefined();act(()=>tree.unmount());page.publication={page_id:'page'};await mount();
 act(()=>action('Page & team').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=page');expect(mockPublish).not.toHaveBeenCalled();
});

it('compact event edit and duplicate controls keep their distinct saved-event routes', async()=>{
 page.events=[{id:'original-event',title:'Sunday supper',status:'Draft'}];await mount();
 const button=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label && typeof node.props.onPress==='function')[0];
 act(()=>button('Edit Sunday supper, private draft').props.onPress());
 expect(mockPush).toHaveBeenLastCalledWith('/creator/event-form?id=original-event&pageId=page');
 act(()=>action('Duplicate event').props.onPress());
 expect(mockPush).toHaveBeenLastCalledWith('/creator/page-event-reuse?pageId=page&sourceEventId=original-event');
 expect(mockCreate).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});


it('published pages have one Events entry instead of a second event list or creation form',async()=>{
 page.publication={page_id:'page'};page.events=[{id:'original-event',title:'Sunday supper',status:'Live'}];await mount();
 expect(action('New event')).toBeUndefined();expect(action('Manage event')).toBeUndefined();
 expect(JSON.stringify(tree.toJSON())).not.toContain('Sunday supper');
 act(()=>action('Events').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page-events?id=page');
 expect(mockPublish).not.toHaveBeenCalled();expect(mockCreate).not.toHaveBeenCalled();
});
it('failed owner access refresh hides cached private details and publication controls with reachable recovery',async()=>{
 page.events=[{id:'private-event',title:'Private supper',status:'Draft'}];await mount();mockLoad.mockRejectedValueOnce(Error('Access unavailable'));
 await act(async()=>action('Check review status').props.onPress());expect(JSON.stringify(tree.toJSON())).not.toContain('Private supper');expect(JSON.stringify(tree.toJSON())).not.toContain('Sunday Table');
 expect(action('Preview & publish')).toBeUndefined();expect(action('New event')).toBeUndefined();expect(action('Try again')).toBeDefined();
 await act(async()=>action('Try again').props.onPress());expect(JSON.stringify(tree.toJSON())).toContain('Private supper');expect(action('Preview & publish')).toBeDefined();
});
it('retired owner callbacks cannot open the event workspace or public page',async()=>{
 page.publication={page_id:'page'};await mount();
 const events=action('Events').props.onPress,publicPage=action('View public page').props.onPress;
 mockCurrent=false;act(()=>{events();publicPage();});expect(mockPush).not.toHaveBeenCalled();
});
it('preserves the existing published community destination',async()=>{
 page.publication={page_id:'page'};await mount();act(()=>action('View public page').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/community/page');
});

it('carries original artwork and LA date into each saved event without changing its editor or public route',async()=>{
 page.events=[{id:'original-event',title:'A long evening with our neighborhood friends',status:'Live',image_url:'https://example.test/poster.jpg',event_date:'2026-09-19'}, {id:'draft-event',title:'Next evening',status:'Draft',image_url:null,event_date:null}];await mount();
 const artwork=tree.root.findByType(EventMediaImage);expect(artwork.props.eventId).toBe('original-event');expect(artwork.props.reference).toBe('https://example.test/poster.jpg');expect(artwork.props.contentFit).toBe('contain');
 const output=JSON.stringify(tree.toJSON());expect(output).toContain('Sat, Sep 19');expect(output).toContain('Date to come');expect(output).toContain('Private draft');expect(output).toContain('A long evening with our neighborhood friends');
 expect(actions().filter(a=>a.props.title==='View in Scene')).toHaveLength(1);expect(mockPublish).not.toHaveBeenCalled();
});

it('opens event management in the same page and retires stale callbacks',async()=>{
 page.events=[{id:'event',title:'Sunday table',status:'Live',category:'community'}];await mount();
 const press=action('Manage event').props.onPress;act(()=>press());expect(mockPush).toHaveBeenLastCalledWith('/creator/event-summary?id=event&pageId=page');
 mockPush.mockClear();mockCurrent=false;act(()=>press());expect(mockPush).not.toHaveBeenCalled();
});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve};}
async function tick(ms:number){await act(async()=>{jest.advanceTimersByTime(ms);await Promise.resolve();});}
it('times out the full workspace read and ignores its late private result after explicit retry',async()=>{
 jest.useFakeTimers();const pending=deferred<any>();mockLoad.mockReturnValueOnce(pending.promise);await mount();
 await tick(12_000);expect(action('Try again')).toBeDefined();expect(action('Preview & publish')).toBeUndefined();
 await act(async()=>action('Try again').props.onPress());expect(action('Preview & publish')).toBeDefined();
 await act(async()=>pending.resolve({...page,draft:{...page.draft,page_data:{name:'Retired private page'}}}));
 expect(JSON.stringify(tree.toJSON())).not.toContain('Retired private page');
});

it('retired preparation cannot dispatch a new event after the action deadline',async()=>{
 jest.useFakeTimers();const pending=deferred<any>();mockPrepare.mockReturnValueOnce(pending.promise);await mount();
 act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>action('Continue').props.onPress());await tick(25_000);
 expect(action('Check saved status').props.disabled).toBe(false);
 await act(async()=>pending.resolve({pageId:'page',eventId:'saved-event',title:'Sunday supper',category:'community'}));
 expect(mockCreate).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
it('continues with the confirmed event when optional recovery-marker cleanup stalls',async()=>{
 jest.useFakeTimers();mockClearAttempt.mockReturnValueOnce(new Promise(()=>{}));await mount();
 act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>action('Continue').props.onPress());await tick(3_000);
 expect(mockPush).toHaveBeenCalledWith('/creator/event-form?id=saved-event&pageId=page');expect(mockCreate).toHaveBeenCalledTimes(1);
});
it('does not navigate from a confirmed event when its page visit retires during cleanup',async()=>{
 jest.useFakeTimers();mockClearAttempt.mockReturnValueOnce(new Promise(()=>{}));await mount();
 act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>action('Continue').props.onPress());mockCurrent=false;await tick(3_000);expect(mockPush).not.toHaveBeenCalled();
});


it('lost event receipt recovers the same saved ID from status and continues without another create',async()=>{
 jest.useFakeTimers();const pending=deferred<any>();mockCreate.mockReturnValueOnce(pending.promise);await mount();
 act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>action('Continue').props.onPress());mockAttempt={pageId:'page',eventId:'saved-event',title:'Sunday supper',category:'community'};
 await tick(25_000);page={...page,events:[{id:'saved-event',title:'Sunday supper',status:'Draft',category:'community'}]};
 await act(async()=>action('Check saved status').props.onPress());expect(action('Continue').props.disabled).toBe(false);
 await act(async()=>action('Continue').props.onPress());expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledTimes(1);
 expect(mockPush).toHaveBeenLastCalledWith('/creator/event-form?id=saved-event&pageId=page');
 await act(async()=>pending.resolve('saved-event'));expect(mockPush).toHaveBeenCalledTimes(1);
});
it('a status read without a saved event retains its original attempt for explicit continuation',async()=>{
 jest.useFakeTimers();mockCreate.mockReturnValueOnce(new Promise(()=>{}));await mount();
 act(()=>action('New event').props.onPress());act(()=>tree.root.findByType(TextInput).props.onChangeText('Sunday supper'));
 await act(async()=>action('Continue').props.onPress());mockAttempt={pageId:'page',eventId:'saved-event',title:'Sunday supper',category:'community'};
 await tick(25_000);await act(async()=>action('Check saved status').props.onPress());
 await act(async()=>action('Continue').props.onPress());expect(mockPrepare).toHaveBeenCalledTimes(1);
 expect(mockCreate.mock.calls[1][0]).toEqual(mockAttempt);expect(mockPush).toHaveBeenCalledWith('/creator/event-form?id=saved-event&pageId=page');
});

it('opens the approved editor without publishing or submitting another review',async()=>{
 await mount();expect(mockPublish).not.toHaveBeenCalled();act(()=>action('Preview & publish').props.onPress());
 expect(mockPush).toHaveBeenLastCalledWith('/creator/page-edit?id=page&mode=approved');expect(mockPublish).not.toHaveBeenCalled();
});
it('published content editing keeps the same managed page and shows its current identity',async()=>{
 page.publication={page_id:'page',name:'New live name',city:'Malibu'};await mount();act(()=>action('Edit page').props.onPress());
 expect(mockPush).toHaveBeenLastCalledWith('/creator/page-edit?id=page&mode=approved');expect(JSON.stringify(tree.toJSON())).toContain('New live name');expect(mockPublish).not.toHaveBeenCalled();
});
it.each(['submitted','declined','needs_more_info'])('does not grant approved editing to %s pages',async status=>{
 page.submissions[0].status=status;await mount();expect(action('Preview & publish')).toBeUndefined();expect(action('Edit page')).toBeUndefined();
});
it('retires captured edit and preview actions when leaving the account or page',async()=>{
 await mount();const edit=action('Edit page').props.onPress,preview=action('Preview & publish').props.onPress;mockCurrent=false;act(()=>{edit();preview();});expect(mockPush).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});

it('offers Join requests only for the published owner community and keeps the exact authorized route',async()=>{
 await mount();expect(action('Join requests')).toBeUndefined();act(()=>tree.unmount());page.publication={page_id:'page'};await mount();
 const request=action('Join requests');expect(request).toBeDefined();act(()=>request.props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page-requests?id=page');
 mockPush.mockClear();mockCurrent=false;act(()=>request.props.onPress());expect(mockPush).not.toHaveBeenCalled();
 mockCurrent=true;act(()=>tree.unmount());page.draft.page_kind='organization';await mount();expect(action('Join requests')).toBeUndefined();
});
it('never offers Join requests from an unavailable owner workspace',async()=>{
 mockLoad.mockRejectedValue(Error('Unavailable'));await mount();expect(action('Join requests')).toBeUndefined();expect(mockPush).not.toHaveBeenCalled();
});
it('remeasures mounted workspace identity and status without replacing its page or actions',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,fontScale:1}}));
 try{page.draft.page_kind='organization';await mount();const component=tree.root.findByType(CreatorPageScreen),scroll=tree.root.findByType(ScrollView),edit=action('Edit page');
 const values=['ORGANIZATION','Sunday Table','Approved · not published · Version 1','Manage page'];const leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>(Array.isArray(n.props.children)?n.props.children.join(''):n.props.children)===v)!;let leaves=values.map(leaf);expect(leaves.every(Boolean)).toBe(true);
 for(const fontScale of [1.35,1]){act(()=>Dimensions.set({window:{...previous,fontScale}}));values.forEach((v,i)=>expect(leaf(v)).not.toBe(leaves[i]));leaves=values.map(leaf);expect(tree.root.findByType(CreatorPageScreen)).toBe(component);expect(tree.root.findByType(ScrollView)).toBe(scroll);expect(action('Edit page')).toBe(edit);}
 expect(mockCreate).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
