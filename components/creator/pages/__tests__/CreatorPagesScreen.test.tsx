jest.mock('../../../ProfileButton',()=>()=>null);
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockSaved=jest.fn(),mockLocal=jest.fn(),mockStart=jest.fn(),mockReadDraft=jest.fn(),mockPush=jest.fn(),mockLegacy=jest.fn(),mockSelect=jest.fn(),mockWorkspace=jest.fn();
let mockAdmin=false;
let mockCurrent=true;
let mockScope={userId:'creator',isCurrent:()=>mockCurrent};
jest.mock('../../../../constants/Admin',()=>({isAdmin:()=>mockAdmin}));
jest.mock('../../../../lib/creatorSpaceEntry',()=>({loadLegacyCreatorSpaces:(...a:unknown[])=>mockLegacy(...a)}));
jest.mock('../../../../lib/selectedCommunity',()=>({setSelectedCommunityId:(...a:unknown[])=>mockSelect(...a)}));
jest.mock('../../../../lib/workspaceContext',()=>({setWorkspace:(...a:unknown[])=>mockWorkspace(...a)}));
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:'creator',isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageWorkspace',()=>({listCreatorPages:(...args:unknown[])=>mockSaved(...args)}));
jest.mock('../../../../lib/creatorPageEditor',()=>({listLocalPageEditors:(...args:unknown[])=>mockLocal(...args),startPageEditor:(...args:unknown[])=>mockStart(...args),readPageEditor:(...args:unknown[])=>mockReadDraft(...args)}));
jest.mock('../CreatorPageTeamInvitations',()=>({CreatorPageTeamInvitations:()=>null}));
jest.mock('../PageCover',()=>({PageCover:()=>null}));
jest.mock('expo-router',()=>({router:{push:(...args:unknown[])=>mockPush(...args),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import CreatorPagesScreen from '../CreatorPagesScreen';
let tree:ReactTestRenderer;
const button=(label:string)=>tree.root.findAll(p=>(p.props.accessibilityLabel===label || p.props.accessibilityLabel?.startsWith(label+', ')) && typeof p.props.onPress==='function')[0];
async function mount(){await act(async()=>{tree=create(<CreatorPagesScreen/>);});}
beforeEach(()=>{jest.clearAllMocks();mockAdmin=false;mockLegacy.mockReset().mockResolvedValue([]);mockCurrent=true;mockScope={userId:'creator',isCurrent:()=>mockCurrent};mockReadDraft.mockReset().mockResolvedValue({id:'new-draft'});mockSaved.mockResolvedValue([{id:'saved',page_kind:'community',page_data:{name:'Sunday Table'}}]);mockLocal.mockResolvedValue([{id:'saved',pageData:{name:'Duplicate'}},{id:'local',kind:'organization',pageData:{name:'Sunset Sessions'}}]);mockStart.mockReset().mockImplementation(async(_scope,prepared)=>{const record={id:'new-draft'};prepared?.(record);return record;});});
afterEach(()=>{act(()=>tree?.unmount());});
it('opens the same saved page and local draft without showing a duplicate editor',async()=>{
 await mount();expect(button('Continue Duplicate')).toBeUndefined();
 act(()=>button('Manage Sunday Table').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page?id=saved');
 act(()=>button('Continue Sunset Sessions').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/page-edit?id=local');
 expect(mockStart).not.toHaveBeenCalled();
});
it('creates only one draft for rapid taps and uses its returned ID',async()=>{
 await mount();const press=button('Create a page').props.onPress;
 await act(async()=>{press();press();});expect(mockStart).toHaveBeenCalledTimes(1);expect(mockStart).toHaveBeenCalledWith(mockScope,expect.any(Function));expect(mockPush).toHaveBeenCalledWith('/creator/page-edit?id=new-draft');
});
it('does not navigate from retired page rows or a late draft receipt',async()=>{
 let resolve:(value:{id:string})=>void=()=>{};mockStart.mockImplementation(()=>new Promise(r=>{resolve=r;}));await mount();
 act(()=>button('Create a page').props.onPress());mockCurrent=false;
 act(()=>{button('Manage Sunday Table').props.onPress();button('Continue Sunset Sessions').props.onPress();});
 await act(async()=>resolve({id:'retired-draft'}));expect(mockPush).not.toHaveBeenCalled();
});
it('shows recovery without a competing create action, then restores creation after the read succeeds',async()=>{
 mockSaved.mockRejectedValueOnce(new Error('Offline'));await mount();expect(button('Create a page')).toBeUndefined();
 expect(mockStart).not.toHaveBeenCalled();
 await act(async()=>button('Try again').props.onPress());
 expect(button('Create a page').props.disabled).toBe(false);
 expect(button('Manage Sunday Table')).toBeDefined();
});
it('ends indefinite Starting with honest explicit recovery while existing spaces stay usable',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});try{mockStart.mockReturnValue(new Promise(()=>{}));await mount();act(()=>button('Create a page').props.onPress());await act(async()=>jest.advanceTimersByTime(12000));expect(button('Check draft')).toBeDefined();expect(button('Manage Sunday Table')).toBeDefined();expect(mockStart).toHaveBeenCalledTimes(1);}finally{jest.useRealTimers();}
});

function pending<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
async function timeout(){await act(async()=>{jest.advanceTimersByTime(12000);});}
it('uncertain write retains one identity and opens only after explicit exact-draft check',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});try{const write=pending<{id:string}>();mockStart.mockImplementation((_scope,prepared)=>{prepared({id:'original'});return write.promise;});await mount();const start=button('Create a page').props.onPress;act(()=>start());await timeout();act(()=>start());expect(mockStart).toHaveBeenCalledTimes(1);expect(button('Create a page').props.disabled).toBe(true);await act(async()=>write.resolve({id:'original'}));expect(mockPush).not.toHaveBeenCalled();await act(async()=>button('Check draft').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-edit?id=original');expect(mockStart).toHaveBeenCalledTimes(1);expect(button('Continue draft')).toBeDefined();}finally{jest.useRealTimers();}
});
it('checking a stalled original save is bounded and duplicate-safe without releasing its write',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});try{const write=pending<{id:string}>(),read=pending<any>();mockStart.mockImplementation((_scope,prepared)=>{prepared({id:'original'});return write.promise;});mockReadDraft.mockReturnValue(read.promise);await mount();act(()=>button('Create a page').props.onPress());await timeout();const check=button('Check draft').props.onPress;act(()=>{check();check();});expect(mockReadDraft).toHaveBeenCalledTimes(1);await timeout();expect(button('Check draft')).toBeDefined();expect(mockReadDraft.mock.calls[0][1].isCurrent()).toBe(false);await act(async()=>read.resolve({id:'original'}));expect(mockPush).not.toHaveBeenCalled();expect(mockStart).toHaveBeenCalledTimes(1);expect(button('Manage Sunday Table')).toBeDefined();}finally{jest.useRealTimers();}
});
it('a rejected save requires exact absent-record evidence before another draft can start',async()=>{
 mockStart.mockImplementation((_scope,prepared)=>{prepared({id:'original'});return Promise.reject(Error('disk'));});await mount();await act(async()=>button('Create a page').props.onPress());expect(button('Create a page').props.disabled).toBe(true);mockReadDraft.mockResolvedValue(null);await act(async()=>button('Check draft').props.onPress());expect(mockReadDraft).toHaveBeenCalledWith('original',expect.objectContaining({userId:'creator'}));expect(button('Create a page').props.disabled).toBe(false);expect(JSON.stringify(tree.toJSON())).toContain('The draft wasn’t saved');
});
it('a rejected acknowledgement with an existing exact record recovers without a second UUID',async()=>{
 mockStart.mockImplementation((_scope,prepared)=>{prepared({id:'original'});return Promise.reject(Error('uncertain'));});mockReadDraft.mockResolvedValue({id:'original'});await mount();await act(async()=>button('Create a page').props.onPress());await act(async()=>button('Check draft').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-edit?id=original');expect(mockStart).toHaveBeenCalledTimes(1);expect(JSON.stringify(tree.toJSON())).not.toContain('wasn’t saved');
});
it.each(['account','visit','unmount'])('old creation/recovery/row callbacks retire on %s',async reason=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});try{const write=pending<{id:string}>();mockStart.mockImplementation((_scope,prepared)=>{prepared({id:'original'});return write.promise;});await mount();const start=button('Create a page').props.onPress,row=button('Manage Sunday Table').props.onPress;act(()=>start());await timeout();const check=button('Check draft').props.onPress;if(reason==='unmount')act(()=>tree.unmount());else{mockScope={userId:reason==='account'?'another':'creator',isCurrent:()=>true};await act(async()=>tree.update(<CreatorPagesScreen/>));}act(()=>{start();row();check();});await act(async()=>write.resolve({id:'original'}));expect(mockPush).not.toHaveBeenCalled();expect(mockReadDraft).not.toHaveBeenCalled();expect(mockStart).toHaveBeenCalledTimes(1);}finally{jest.useRealTimers();}
});

it('published list identity reflects live changes while the original private draft remains separate',async()=>{
 mockSaved.mockResolvedValue([{id:'saved',page_kind:'community',page_data:{name:'Old application title'},published_data:{name:'Current community',city:'Malibu'}}]);await mount();
 expect(button('Manage Current community')).toBeDefined();expect(button('Manage Old application title')).toBeUndefined();act(()=>button('Manage Current community').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page?id=saved');
});

const legacy=(extra={})=>({id:'legacy',name:'Existing community',kind:'community',route:'/(creator)/today',legacy:{workspace:'community',communityId:'legacy',status:'active'},...extra});
it('existing live community remains reachable even when new-page reads fail',async()=>{
 mockSaved.mockRejectedValue(Error('new-page contract unavailable'));mockLegacy.mockResolvedValue([legacy()]);await mount();
 act(()=>button('Manage Existing community').props.onPress());
 expect(mockWorkspace).toHaveBeenCalledWith('community');expect(mockSelect).toHaveBeenCalledWith('legacy');expect(mockPush).toHaveBeenCalledWith('/(creator)/today');
});
it('approved organizer selects its independent workspace without a new page',async()=>{
 mockSaved.mockResolvedValue([]);mockLocal.mockResolvedValue([]);mockLegacy.mockResolvedValue([legacy({id:'legacy-organizer-approval',name:'Your events',kind:'organization',route:'/(creator)/organizer-home',legacy:{workspace:'organization',status:'approved'}})]);await mount();
 act(()=>button('Manage Your events').props.onPress());expect(mockWorkspace).toHaveBeenCalledWith('organization');expect(mockSelect).not.toHaveBeenCalled();expect(mockPush).toHaveBeenCalledWith('/(creator)/organizer-home');
});
it('does not duplicate an existing community that has a new page identity',async()=>{
 mockLegacy.mockResolvedValue([legacy({id:'saved',name:'Sunday Table'})]);await mount();
 expect(tree.root.findAll(p=>p.props.accessibilityLabel==='Manage Sunday Table, Community · Private page'&&typeof p.props.onPress==='function')).toHaveLength(1);
});
it('an unavailable entitlement read exposes retry while new pages remain usable',async()=>{
 mockLegacy.mockRejectedValueOnce(Error('old access offline'));await mount();expect(button('Manage Sunday Table')).toBeDefined();expect(button('Manage Existing community')).toBeUndefined();
 mockLegacy.mockResolvedValue([legacy()]);await act(async()=>button('Try again to load existing creator access').props.onPress());expect(button('Manage Existing community')).toBeDefined();
});
it('retired legacy callbacks cannot select a workspace or navigate',async()=>{
 mockLegacy.mockResolvedValue([legacy()]);await mount();const press=button('Manage Existing community').props.onPress;mockCurrent=false;act(press);expect(mockPush).not.toHaveBeenCalled();expect(mockWorkspace).not.toHaveBeenCalled();expect(mockSelect).not.toHaveBeenCalled();
});
it('preserves the founder approval route behind the existing admin check',async()=>{
 await mount();expect(button('Review creator applications')).toBeUndefined();mockAdmin=true;await act(async()=>tree.update(<CreatorPagesScreen/>));
 act(()=>button('Review creator applications').props.onPress());expect(mockPush).toHaveBeenCalledWith('/admin/applications');
});

it('releases a rejected read-only reservation lookup only after explicit Check when no identity was prepared',async()=>{
 mockStart.mockRejectedValue(Error('Cannot read local drafts'));await mount();await act(async()=>button('Create a page').props.onPress());
 expect(button('Create a page').props.disabled).toBe(true);
 await act(async()=>button('Check draft').props.onPress());expect(mockReadDraft).not.toHaveBeenCalled();
 expect(button('Create a page').props.disabled).toBe(false);expect(JSON.stringify(tree.toJSON())).toContain('The draft wasn’t started');
});
it('keeps an unresolved read-only reservation lookup owned until its original result settles',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});try{
  const lookup=pending<any>();mockStart.mockReturnValue(lookup.promise);await mount();act(()=>button('Create a page').props.onPress());await timeout();
  await act(async()=>button('Check draft').props.onPress());expect(button('Create a page').props.disabled).toBe(true);
  expect(mockStart).toHaveBeenCalledTimes(1);expect(mockReadDraft).not.toHaveBeenCalled();
  await act(async()=>lookup.resolve({id:'existing-reservation'}));expect(mockPush).not.toHaveBeenCalled();
  await act(async()=>button('Check draft').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/page-edit?id=existing-reservation');
 }finally{jest.useRealTimers();}
});

it('distinguishes same-named saved and local pages by actual kind and truthful visible status',async()=>{
 mockSaved.mockResolvedValue([{id:'community',page_kind:'community',page_data:{name:'Shared name'}},{id:'organization',page_kind:'organization',page_data:{name:'Shared name'},published_data:{name:'Shared name'}}]);
 mockLocal.mockResolvedValue([{id:'local-community',kind:'community',pageData:{name:'Shared name'},pending:true},{id:'local-org',kind:'organization',pageData:{name:'Shared name'}}]);await mount();
 const labels=['Manage Shared name, Community · Private page','Manage Shared name, Organization · Published','Continue Shared name, Community · Check saved status','Continue Shared name, Organization · Draft on this device'];
 labels.forEach(label=>expect(button(label)).toBeDefined());labels.forEach(label=>act(()=>button(label).props.onPress()));
 expect(mockPush.mock.calls.map(c=>c[0])).toEqual(['/creator/page?id=community','/creator/page?id=organization','/creator/page-edit?id=local-community','/creator/page-edit?id=local-org']);
});
