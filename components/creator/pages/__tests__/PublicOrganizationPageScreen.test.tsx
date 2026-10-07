import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Pressable} from 'react-native';
const mockCheck=jest.fn(),mockLoad=jest.fn(),mockState=jest.fn(),mockCount=jest.fn(),mockPending=jest.fn(),mockPrepare=jest.fn(),mockSend=jest.fn(),mockResolve=jest.fn(),mockPush=jest.fn();
let mockScope:any;
jest.mock('../../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/publishedOrganizationPage',()=>({loadPublishedOrganizationPage:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../../../../lib/organizationPageFollow',()=>({checkOrganizationFollowAttempt:(...a:unknown[])=>mockCheck(...a),readOrganizationFollowState:(...a:unknown[])=>mockState(...a),readOrganizationFollowerCount:(...a:unknown[])=>mockCount(...a),readPendingOrganizationFollow:(...a:unknown[])=>mockPending(...a),prepareOrganizationFollow:(...a:unknown[])=>mockPrepare(...a),sendOrganizationFollowAttempt:(...a:unknown[])=>mockSend(...a),resolveOrganizationFollowAttempt:(...a:unknown[])=>mockResolve(...a)}));
jest.mock('../PublishedPageCover',()=>({PublishedPageCover:()=>null}));
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a),back:jest.fn()},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import PublicOrganizationPageScreen from '../PublicOrganizationPageScreen';
import {PublishedPageCover} from '../PublishedPageCover';
let tree:ReactTestRenderer,state:any,pending:any;
const action=(title:string)=>tree.root.findAll(v=>v.props.accessibilityLabel===title && typeof v.props.onPress==='function')[0]!;
const mount=async()=>{await act(async()=>{tree=create(<PublicOrganizationPageScreen pageId="page"/>);});};
beforeEach(()=>{jest.clearAllMocks();mockScope={userId:'member',isCurrent:()=>true};state={page_id:'page',user_id:'member',following:false,version:0};pending=null;mockLoad.mockResolvedValue({page:{pageId:'page',ownerId:'owner',kind:'organization',name:'Sunday Table',purpose:'Neighbors together',city:'Los Angeles',description:null,coverMediaId:'approved-cover',photoUrl:null},upcomingEvents:[{id:'same-event',title:'Saved gathering',event_date:'2026-09-20',venue:'Los Angeles',ticket_price:0}],pastEvents:[]});mockCheck.mockImplementation(async()=>({receipt:null,state,conflict:false}));mockState.mockImplementation(async()=>state);mockCount.mockResolvedValue(0);mockPending.mockImplementation(async()=>pending);mockPrepare.mockImplementation(async(s:any,following:boolean)=>{pending={id:'original',pageId:'page',userId:mockScope.userId,expectedVersion:s.version,following};return pending;});mockSend.mockImplementation(async(a:any)=>{state={...state,following:a.following,version:a.expectedVersion+1};return{state,receipt:{id:a.id}};});mockResolve.mockImplementation(async()=>{pending=null;return state;});});
afterEach(()=>act(()=>tree?.unmount()));
it('uses the exact public cover and saved event destination',async()=>{await mount();expect(tree.root.findByType(PublishedPageCover).props).toMatchObject({pageId:'page',mediaId:'approved-cover',surface:'scene'});act(()=>action('Open Saved gathering').props.onPress());expect(mockPush).toHaveBeenCalledWith('/event/same-event');});
it('makes one durable follow for a double activation and then shows confirmed following',async()=>{await mount();const press=action('Follow').props.onPress;await act(async()=>{press();press();});expect(mockPrepare).toHaveBeenCalledTimes(1);expect(mockSend).toHaveBeenCalledTimes(1);expect(action('Following')).toBeDefined();expect(action('Retry same action')).toBeUndefined();});
it('keeps an uncertain attempt, checks without a mutation and retries the same intent',async()=>{mockSend.mockRejectedValueOnce(new Error('Lost response'));await mount();await act(async()=>action('Follow').props.onPress());expect(action('Check following')).toBeDefined();mockResolve.mockRejectedValueOnce(new Error('Still uncertain'));await act(async()=>action('Check following').props.onPress());expect(mockSend).toHaveBeenCalledTimes(1);await act(async()=>action('Retry same action').props.onPress());expect(mockSend).toHaveBeenCalledTimes(2);expect(mockSend.mock.calls[1][0]).toEqual(mockSend.mock.calls[0][0]);expect(mockPrepare).toHaveBeenCalledTimes(1);expect(action('Following')).toBeDefined();});
it('allows signed-out viewing without dispatching a personal follow read or mutation',async()=>{mockScope={userId:null,isCurrent:()=>true};await mount();expect(action('Open Saved gathering')).toBeDefined();expect(action('Follow')).toBeUndefined();expect(mockState).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();});
it('returns the owner to management of this page only',async()=>{mockScope={userId:'owner',isCurrent:()=>true};await mount();expect(action('Follow')).toBeUndefined();act(()=>action('Manage').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page?id=page');});
it('does not run recovery or update the new account after a retired follow response',async()=>{let resolve:any;mockSend.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await mount();await act(async()=>action('Follow').props.onPress());mockScope.isCurrent=()=>false;mockScope={userId:'other',isCurrent:()=>true};pending=null;state={...state,user_id:'other'};await act(async()=>tree.update(<PublicOrganizationPageScreen pageId="page"/>));await act(async()=>resolve({receipt:{id:'original'},state:{following:true}}));expect(mockResolve).not.toHaveBeenCalled();expect(action('Follow')).toBeDefined();});
it('shows following after a lost reply is confirmed by the read refresh, without a second write',async()=>{
 mockSend.mockImplementationOnce(async()=>{state={...state,following:true,version:1};throw new Error('Reply lost');});
 mockCheck.mockImplementation(async()=>({receipt:{id:'original',following:true},state,conflict:false}));
 await mount();await act(async()=>action('Follow').props.onPress());expect(action('Following')).toBeDefined();expect(action('Retry same action')).toBeUndefined();expect(mockSend).toHaveBeenCalledTimes(1);
});

it('uses the shared event follow control in preview without preparing or sending an action',async()=>{
 const {OrganizationPageFollowControls}=require('../OrganizationPageFollowControls');const notice=jest.fn();
 await act(async()=>{tree=create(<OrganizationPageFollowControls pageId="page" ownerId="owner" scope={mockScope} surface="light" preview onPreview={notice}/>);});
 act(()=>action('Follow').props.onPress());expect(notice).toHaveBeenCalledTimes(1);expect(mockPrepare).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();
});

it.each(['owner','member'])('guest preview ignores %s follow state and recovery while retaining the real view',async viewer=>{
 const {OrganizationPageFollowControls}=require('../OrganizationPageFollowControls');const notice=jest.fn();
 mockScope={userId:viewer,isCurrent:()=>true};state={...state,user_id:viewer,following:true};pending={id:'original',following:false};
 await act(async()=>{tree=create(<OrganizationPageFollowControls pageId="page" ownerId="owner" scope={mockScope} preview onPreview={notice}/>);});
 expect(action('Follow')).toBeDefined();expect(action('Following')).toBeUndefined();expect(action('Manage')).toBeUndefined();expect(action('Retry same action')).toBeUndefined();
 expect(mockState).not.toHaveBeenCalled();expect(mockPending).not.toHaveBeenCalled();expect(mockCheck).not.toHaveBeenCalled();
 act(()=>action('Follow').props.onPress());expect(notice).toHaveBeenCalledTimes(1);expect(mockPrepare).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();
 pending=null;await act(async()=>tree.update(<OrganizationPageFollowControls pageId="page" ownerId="owner" scope={mockScope}/>));
 expect(action(viewer==='owner'?'Manage':'Following')).toBeDefined();expect(mockState).toHaveBeenCalled();
});
