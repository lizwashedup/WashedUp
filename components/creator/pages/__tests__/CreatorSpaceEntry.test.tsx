import React from 'react';
import { Text, Dimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPush=jest.fn(),mockPrepare=jest.fn(),mockRefresh=jest.fn(),mockApplicationsRefresh=jest.fn();
let mockActive=true,mockUser='alice',mockSpaces:any,mockApplications:any;
const mockScope={userId:'alice',isCurrent:()=>mockActive};
jest.mock('expo-router',()=>({router:{push:(...a:unknown[])=>mockPush(...a)}}));
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockUser,error:null,isLoading:false}})}));
jest.mock('../../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:(_scope:any,read:any)=>read===require('../../../../lib/creatorManagement').loadManagedApplications?mockApplications:mockSpaces}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../../constants/Typography').AfterglowFallbackFonts})}));
jest.mock('../../../../lib/creatorManagement',()=>({loadManagedSpaces:jest.fn(),loadManagedApplications:jest.fn(),managedSpaceStatus:()=> 'Community · Manage',prepareCreatorSpace:(...a:unknown[])=>mockPrepare(...a)}));
jest.mock('lucide-react-native',()=>({ChevronRight:()=>null,ChevronDown:()=>null,Users:()=>null,Building2:()=>null}));
import {CreatorSpaceEntry} from '../CreatorSpaceEntry';
let tree:ReactTestRenderer;
const community={id:'sunset',kind:'community',name:'Sunset Club',route:'/(tabs)/friends/manage/(tools)/today',legacy:{workspace:'community',communityId:'sunset',status:'active'}};
const data={spaces:[community],invitations:[]};
const organization={id:'org',kind:'organization',name:'Sunset Studio',route:'/(tabs)/friends/manage/(tools)/organizer-home',legacy:{workspace:'organization',status:'approved'}};
const text=()=>tree.root.findAllByType(Text).map(n=>String(n.props.children)).join('|');
const button=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
function mount(expanded=false){act(()=>{tree=create(<CreatorSpaceEntry userId={mockUser} expanded={expanded}/>);});}
beforeEach(()=>{jest.clearAllMocks();mockActive=true;mockUser='alice';mockSpaces={data,loading:false,error:null,refresh:mockRefresh};mockApplications={data:[],loading:false,error:null,refresh:mockApplicationsRefresh};mockRefresh.mockResolvedValue(data);mockApplicationsRefresh.mockResolvedValue([]);});
afterEach(()=>act(()=>tree?.unmount()));
it('opens the named community only after refreshing its exact access and selecting its context',async()=>{
 mount();await act(async()=>button('Manage Sunset Club').props.onPress());expect(mockRefresh).toHaveBeenCalledTimes(1);expect(mockPrepare).toHaveBeenCalledWith(community,mockScope);expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/today');
});
it('does not open a removed or revoked community from a stale row',async()=>{
 mount();mockRefresh.mockResolvedValue({spaces:[],invitations:[]});await act(async()=>button('Manage Sunset Club').props.onPress());expect(mockPrepare).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
it('rejects repeated taps and a result arriving after the visit ends',async()=>{
 let resolve!:(v:any)=>void;mockRefresh.mockImplementation(()=>new Promise(done=>resolve=done));mount();const press=button('Manage Sunset Club').props.onPress;
 act(()=>{press();press();});expect(mockRefresh).toHaveBeenCalledTimes(1);mockActive=false;await act(async()=>resolve(data));expect(mockPush).not.toHaveBeenCalled();
});
it('opens the current pending invitation without inventing another destination',async()=>{
 const invitation={pageId:'team',invitationId:'invite',pageName:'Sunset Studio'};mockSpaces.data={...data,invitations:[invitation]};mockRefresh.mockResolvedValue(mockSpaces.data);mount(true);
 await act(async()=>button('Review invitation to Sunset Studio').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-team?id=team&invitationId=invite');
});
it('keeps application status reachable when management reads fail',async()=>{
 mockSpaces={...mockSpaces,error:'offline'};mockApplications.data=[{id:'app',track:'community_leader',status:'in_review'}];mockApplicationsRefresh.mockResolvedValue(mockApplications.data);mount();
 expect(button('Manage Sunset Club')).toBeUndefined();await act(async()=>button('View community application').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/apply');
});
it('never navigates from a speculative loading state or a previous account',()=>{
 mockSpaces={...mockSpaces,data:undefined,loading:true};mount();expect(button('Manage Sunset Club')).toBeUndefined();mockUser='bob';act(()=>tree.update(<CreatorSpaceEntry userId={mockUser}/>));expect(tree.toJSON()).toBeNull();
});
it('keeps Yours compact and provides all named entries in the expanded directory',()=>{
 mockSpaces.data={spaces:[community,{...community,id:'two',name:'Second Club'},{...community,id:'three',name:'Third Club'}],invitations:[]};mount();
 expect(button('Manage Third Club')).toBeUndefined();act(()=>button('See everything you manage').props.onPress());expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage');
 act(()=>tree.update(<CreatorSpaceEntry userId={mockUser} expanded/>));expect(button('Manage Third Club')).toBeDefined();
});
it('hides the compact section for ordinary members and explains the expanded empty state',()=>{
 mockSpaces.data={spaces:[],invitations:[]};mount();expect(tree.toJSON()).toBeNull();
 act(()=>tree.update(<CreatorSpaceEntry userId={mockUser} expanded/>));expect(tree.root.findAllByType(Text).some(n=>String(n.props.children).includes('Start a community or create an event.'))).toBe(true);
});


it('does not finish an old entry when Yours has already changed accounts',async()=>{
 let finish!:(v:any)=>void;mockRefresh.mockImplementation(()=>new Promise(resolve=>finish=resolve));mount();act(()=>button('Manage Sunset Club').props.onPress());
 act(()=>tree.update(<CreatorSpaceEntry userId="bob"/>));await act(async()=>finish(data));expect(mockPush).not.toHaveBeenCalled();expect(mockPrepare).not.toHaveBeenCalled();
});


it('leaves room for Yours content on a small phone with larger text',()=>{
 const previous=Dimensions.get('window');
 try {
  act(()=>Dimensions.set({window:{...previous,height:568,width:320,fontScale:1.35}}));
  mockSpaces.data={spaces:[community,{...community,id:'two',name:'Second Club'}],invitations:[]};mount();
  expect(button('Manage Sunset Club')).toBeDefined();expect(button('Manage Second Club')).toBeUndefined();expect(button('See everything you manage')).toBeDefined();
 } finally {act(()=>Dimensions.set({window:previous}));}
});

it('groups a mixed creator’s communities and organizations and keeps archived tools out of the main list',()=>{
 mockSpaces.data={spaces:[community,organization,{...community,id:'old',name:'Old Club',legacy:{...community.legacy,status:'archived'}}],invitations:[]};mount(true);
 expect(text()).toContain('Communities');expect(text()).toContain('Organizations');expect(button('Start another community')).toBeDefined();
 expect(button('Organization settings for Sunset Studio')).toBeDefined();expect(button('Manage Old Club')).toBeUndefined();
 act(()=>button('Archived communities').props.onPress());expect(button('Manage Old Club')).toBeDefined();
 act(()=>button('Archived communities').props.onPress());expect(button('Manage Old Club')).toBeUndefined();
});
it.each(['community','organization'])('shows only relevant sections for a %s-only creator',kind=>{
 mockSpaces.data={spaces:[kind==='community'?community:organization],invitations:[]};mount(true);
 expect(text()).toContain(kind==='community'?'Communities':'Organizations');expect(text()).not.toContain(kind==='community'?'Organizations':'Communities');
 expect(button('Create an event')).toBeUndefined();
});
it('opens organization settings in the freshly verified organization context',async()=>{
 mockSpaces.data={spaces:[community,organization],invitations:[]};mockRefresh.mockResolvedValue(mockSpaces.data);mount(true);
 await act(async()=>button('Organization settings for Sunset Studio').props.onPress());
 expect(mockPrepare).toHaveBeenCalledWith(organization,mockScope);expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/menu?fromManagementDirectory=1');
});
it('opens organization events directly without selecting the preceding community',async()=>{
 mockSpaces.data={spaces:[community,organization],invitations:[]};mockRefresh.mockResolvedValue(mockSpaces.data);mount(true);
 await act(async()=>button('Events for Sunset Studio').props.onPress());
 expect(mockPrepare).toHaveBeenCalledWith(organization,mockScope);expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/events?fromManagementDirectory=1');
});
it('rejects shortcut navigation after the organization access is revoked',async()=>{
 mockSpaces.data={spaces:[organization],invitations:[]};mockRefresh.mockResolvedValue(data);mount(true);
 await act(async()=>button('Organization settings for Sunset Studio').props.onPress());expect(mockPrepare).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
it('does not apply legacy organization shortcuts to page-team permissions',()=>{
 mockSpaces.data={spaces:[{...organization,legacy:undefined,route:'/creator/page-team?id=org'}],invitations:[]};mount(true);
 expect(button('Organization settings for Sunset Studio')).toBeUndefined();expect(button('Manage Sunset Studio')).toBeDefined();
});
it('does not call a first approved setup another community',()=>{
 mockSpaces.data={spaces:[{...community,legacy:{workspace:'community',status:'approved'}}],invitations:[]};mount(true);
 expect(button('Start a community')).toBeDefined();expect(button('Start another community')).toBeUndefined();
});
