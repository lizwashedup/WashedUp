import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad=jest.fn(),mockPersist=jest.fn(),mockDispatch=jest.fn(),mockCheck=jest.fn(),mockReadLocal=jest.fn(),mockReconcile=jest.fn(),mockBusy=jest.fn(),mockReplace=jest.fn(),mockDismissTo=jest.fn();
const mockPick=jest.fn(),mockUpload=jest.fn(),mockPhotoCheck=jest.fn(),mockPhotoRead=jest.fn(),mockPhotoClear=jest.fn(),mockPhotoReset=jest.fn();
let mockAccountError: Error | null = null;
let mockFocused=true,mockEpoch=0;
let mockScopesByPage: Record<string, {userId:string;isCurrent:()=>boolean}> | undefined;
let mockCurrent=true, mockScope={userId:'creator',isCurrent:()=>mockCurrent};
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(pageId:string)=>({scope:mockAccountError ? null : mockScopesByPage?.[pageId] ?? mockScope,focused:mockFocused,account:{viewerId:mockScope.userId,epoch:mockEpoch,isLoading:false,error:mockAccountError,isCurrent:()=>mockCurrent,retry:jest.fn()}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageContent',()=>({...jest.requireActual('../../../../lib/creatorPageContent'),loadCreatorPageContentEditor:(...a:unknown[])=>mockLoad(...a),persistCreatorPageContentDraft:(...a:unknown[])=>mockPersist(...a),dispatchCreatorPageContent:(...a:unknown[])=>mockDispatch(...a),checkCreatorPageContentAttempt:(...a:unknown[])=>mockCheck(...a),readCreatorPageContentDraft:(...a:unknown[])=>mockReadLocal(...a),reconcileCreatorPageContent:(...a:unknown[])=>mockReconcile(...a),creatorPageContentBusy:()=>mockBusy()}));
jest.mock('../../../../lib/creatorPageMedia',()=>({pickPageCover:(...a:unknown[])=>mockPick(...a),uploadPageCover:(...a:unknown[])=>mockUpload(...a),checkPageCover:(...a:unknown[])=>mockPhotoCheck(...a),readPageCoverAttempt:(...a:unknown[])=>mockPhotoRead(...a),clearPageCoverAttempt:(...a:unknown[])=>mockPhotoClear(...a),resetUnreadablePageCoverAttempt:(...a:unknown[])=>mockPhotoReset(...a)}));
jest.mock('../../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('../PageCover',()=>({PageCover:()=>null}));
jest.mock('expo-router',()=>({router:{replace:(...a:unknown[])=>mockReplace(...a),dismissTo:(...a:unknown[])=>mockDismissTo(...a)},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../../lib/haptics',()=>({hapticLight:()=>{},hapticSelection:()=>{}}));
import ApprovedPageEditorScreen from '../ApprovedPageEditorScreen';
import { CommunityClassificationFields } from '../CommunityClassificationFields';
import { PageAction, PageFrame } from '../PageFrame';
import { PageCover } from '../PageCover';
import { Field } from '../../ApplyFormKit';
import { StackActions, StackRouter } from '@react-navigation/routers';

// Exercise the installed router's POP_TO behavior, not a replacement stack model.
// Expo Router dismissTo translates the href to this action; absent destinations
// replace the current screen, while existing destinations retain their route key.
const stackRouter = StackRouter({});
const stackOptions = {
  routeNames: ['community/[id]', 'creator/page', 'creator/page-team', 'creator/page-edit'],
  routeParamList: {},
  routeGetIdList: {},
};
let mockStackState: ReturnType<typeof stackRouter.getInitialState> | undefined;
function startStack(routes: { name: string; key: string; params?: Record<string, string> }[]) {
  mockStackState = { ...stackRouter.getInitialState(stackOptions), routes, index: routes.length - 1 };
}
function applyDismissTo(href: string) {
  if (!mockStackState) return;
  const destination = new URL(href, 'https://local.test');
  const next = stackRouter.getStateForAction(mockStackState, StackActions.popTo(
    destination.pathname.slice(1), Object.fromEntries(destination.searchParams.entries()),
  ), stackOptions);
  if (!next) throw new Error('Return destination was not handled by the installed stack router');
  mockStackState = stackRouter.getRehydratedState(next, stackOptions);
}
const stackKeys = () => mockStackState!.routes.map(route => route.key);
const pendingPublication = () => {
  data.draft.pending = { requestId: 'original-publish', action: 'publish', expectedVersion: 0 };
};
let tree:ReactTestRenderer,data:any;
const action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;
const field=(label:string)=>tree.root.findAllByType(Field).find(n=>n.props.label===label)!;
const content={name:'Sunday Table',purpose:'A place for neighbors to gather',city:'Los Angeles',discovery_area:'Santa Monica',categories:['outdoors'],description:null,photo_url:null,cover_media_id:null};
async function mount(props:any={}){await act(async()=>{tree=create(<ApprovedPageEditorScreen pageId="page" {...props}/>);});}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
beforeEach(()=>{jest.clearAllMocks();mockAccountError=null;mockFocused=true;mockEpoch=0;mockScopesByPage=undefined;mockStackState=undefined;mockDismissTo.mockImplementation(applyDismissTo);mockCurrent=true;mockScope={userId:'creator',isCurrent:()=>mockCurrent};data={state:{page_id:'page',page_kind:'community',state:'published',audience:'everyone',version:0,published_version:0,content:{...content},live_content:{...content}},draft:{pageId:'page',userId:'creator',baseVersion:0,content:{...content}}};
 mockLoad.mockImplementation(async()=>data);mockPersist.mockResolvedValue(undefined);mockBusy.mockReturnValue(false);mockReadLocal.mockImplementation(async()=>data.draft);mockPhotoRead.mockResolvedValue(null);mockPhotoClear.mockResolvedValue(undefined);mockPhotoReset.mockResolvedValue(undefined);
 mockDispatch.mockImplementation(async(d:any,kind:string)=>{const version=d.baseVersion+(kind==='save'?1:0),draft={...d,baseVersion:version,pending:undefined},receipt={action:kind,version,published_version:kind==='publish'?version:data.state.published_version};data={...data,state:{...data.state,version,content:d.content},draft};return{draft,receipt};});
 mockCheck.mockImplementation(async()=>({draft:data.draft,receipt:null,active:false}));mockReconcile.mockImplementation(async(d:any,keep:boolean)=>({...data,draft:{...d,baseVersion:data.state.version,pending:undefined,content:keep?d.content:data.state.content}}));
});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});
it('keeps the published page live, saves preview privately and publishes only on an explicit tap',async()=>{await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your page stays live as it is');act(()=>field('Name').props.onChange('A new Sunday'));const preview=action('Preview changes').props.onPress;await act(async()=>{preview();preview();});expect(mockDispatch).toHaveBeenCalledTimes(1);expect(mockDispatch.mock.calls[0][1]).toBe('save');expect(action('Publish changes')).toBeDefined();expect(mockDismissTo).not.toHaveBeenCalled();await act(async()=>action('Publish changes').props.onPress());expect(mockDispatch.mock.calls[1][1]).toBe('publish');expect(mockDismissTo).toHaveBeenCalledWith('/creator/page?id=page');});
it('lets an approved private page publish without creator questions or another review',async()=>{data.state={...data.state,state:'approved',published_version:null,live_content:null};await mount();await act(async()=>action('Preview changes').props.onPress());expect(action('Publish page')).toBeDefined();expect(JSON.stringify(tree.toJSON())).not.toContain('Submit for review');await act(async()=>action('Publish page').props.onPress());expect(mockDispatch.mock.calls[1][1]).toBe('publish');});
it('saves draft as a secondary action without leaving or publishing',async()=>{await mount();await act(async()=>action('Save draft').props.onPress());expect(mockDispatch.mock.calls[0][1]).toBe('save');expect(mockDispatch).toHaveBeenCalledTimes(1);expect(mockDismissTo).not.toHaveBeenCalled();expect(action('Preview changes')).toBeDefined();expect(JSON.stringify(tree.toJSON())).toContain('Draft saved');});
it('keeps delegates in the team workspace after publishing and on Back',async()=>{await mount({returnToTeam:true});act(()=>tree.root.findByType(PageFrame).props.onBack());expect(mockDismissTo).toHaveBeenLastCalledWith('/creator/page-team?id=page');await act(async()=>action('Preview changes').props.onPress());await act(async()=>action('Publish changes').props.onPress());expect(mockDismissTo).toHaveBeenLastCalledWith('/creator/page-team?id=page');});
it('rejects invalid fields before a save and preserves the text',async()=>{await mount();act(()=>field('Name').props.onChange('x'));await act(async()=>action('Preview changes').props.onPress());expect(field('Name').props.value).toBe('x');expect(mockDispatch).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Name needs');});
it('shows a resumed exact attempt without allowing edits or publishing',async()=>{data.draft.pending={requestId:'original',action:'save',expectedVersion:0,content:data.draft.content};await mount();expect(action('Check status')).toBeDefined();expect(field('Name').props.editable).toBe(false);expect(action('Preview changes')).toBeUndefined();await act(async()=>action('Check status').props.onPress());expect(mockCheck).toHaveBeenCalledTimes(1);expect(mockDispatch).not.toHaveBeenCalled();await act(async()=>action('Retry original').props.onPress());expect(mockDispatch.mock.calls[0][0].pending.requestId).toBe('original');});
it('keeps local words when a newer saved version is discovered and requires explicit reconciliation',async()=>{data.state.version=2;data.state.content={...content,name:'Other version'};await mount();expect(field('Name').props.value).toBe('Sunday Table');expect(field('Name').props.editable).toBe(false);await act(async()=>action('Keep my changes').props.onPress());expect(mockReconcile.mock.calls[0][1]).toBe(true);expect(field('Name').props.value).toBe('Sunday Table');expect(field('Name').props.editable).toBe(true);expect(mockDispatch).not.toHaveBeenCalled();});
it('requires decoded cover preview before publishing and supports removal',async()=>{data.draft.content={...content,cover_media_id:'cover'};data.state.content=data.draft.content;await mount();await act(async()=>action('Preview changes').props.onPress());expect(action('Publish changes').props.disabled).toBe(true);act(()=>tree.root.findByType(PageCover).props.onReady(true));expect(action('Publish changes').props.disabled).toBe(false);act(()=>action('Keep editing').props.onPress());act(()=>action('Remove photo').props.onPress());expect(field('Name').props.value).toBe('Sunday Table');await act(async()=>action('Preview changes').props.onPress());expect(mockDispatch.mock.calls[1][0].content.cover_media_id).toBeNull();expect(action('Publish changes').props.disabled).toBe(false);});
it('resumes the existing cover upload and does not publish it automatically',async()=>{const attempt={pageId:'page',mediaId:'pending'};mockPhotoRead.mockResolvedValue(attempt);mockUpload.mockResolvedValue({id:'pending'});mockPhotoClear.mockImplementation(async()=>{mockPhotoRead.mockResolvedValue(null);});await mount();expect(action('Preview changes').props.disabled).toBe(true);await act(async()=>action('Resume upload').props.onPress());expect(mockUpload.mock.calls[0][0]).toBe(attempt);expect(mockPersist.mock.calls[0][0].content.cover_media_id).toBe('pending');expect(mockDispatch).not.toHaveBeenCalled();expect(action('Preview changes').props.disabled).toBe(false);});
it('a cancelled photo picker makes no page save or upload',async()=>{mockPick.mockResolvedValue(null);await mount();await act(async()=>action('Choose photo').props.onPress());expect(mockUpload).not.toHaveBeenCalled();expect(mockDispatch).not.toHaveBeenCalled();});
it('retains typed text when local persistence fails',async()=>{mockPersist.mockRejectedValueOnce(Error('Storage full'));await mount();await act(async()=>field('Name').props.onChange('Keep this name'));expect(field('Name').props.value).toBe('Keep this name');expect(JSON.stringify(tree.toJSON())).toContain('Keep this page open');});
it('bounds a stalled initial read and ignores a late response',async()=>{jest.useFakeTimers({doNotFake:['queueMicrotask','setImmediate']});const stalled=deferred<any>();mockLoad.mockReturnValueOnce(stalled.promise);await mount();await act(async()=>jest.advanceTimersByTimeAsync(15001));expect(action('Try again')).toBeDefined();await act(async()=>action('Try again').props.onPress());expect(field('Name').props.value).toBe('Sunday Table');await act(async()=>stalled.resolve({...data,draft:{...data.draft,content:{...content,name:'Late'}}}));expect(field('Name').props.value).toBe('Sunday Table');});
it('retires publication feedback when the account changes',async()=>{const wait=deferred<any>();await mount();await act(async()=>action('Preview changes').props.onPress());mockDispatch.mockReturnValueOnce(wait.promise);act(()=>action('Publish changes').props.onPress());mockCurrent=false;await act(async()=>wait.resolve({draft:data.draft,receipt:{action:'publish',version:1,published_version:1}}));expect(mockDismissTo).not.toHaveBeenCalled();});
it('bounds photo uploads but excludes deliberate picker time from the deadline',async()=>{jest.useFakeTimers({doNotFake:['queueMicrotask','setImmediate']});const selected=deferred<any>();mockPick.mockImplementationOnce(async(_p,_s,open)=>{open(true);try{return await selected.promise;}finally{open(false);}});await mount();await act(async()=>{action('Choose photo').props.onPress();});act(()=>{jest.advanceTimersByTime(60000);});expect(tree.root.findByType(PageFrame).props.busy).toBe(true);await act(async()=>selected.resolve(null));expect(tree.root.findByType(PageFrame).props.busy).toBe(false);const upload=deferred<any>(),attempt={pageId:'page',mediaId:'photo'};mockPick.mockResolvedValueOnce(attempt);mockUpload.mockReturnValueOnce(upload.promise);await act(async()=>{action('Choose photo').props.onPress();});act(()=>{jest.advanceTimersByTime(25001);});await act(async()=>{});expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(action('Check photo')).toBeDefined();await act(async()=>upload.resolve({id:'photo'}));expect(mockPersist).not.toHaveBeenCalled();});
it('renders every filled action with the shared one-line button treatment',async()=>{await mount();expect(tree.root.findAllByType(PageAction).every(a=>a.props.singleLine)).toBe(true);await act(async()=>action('Preview changes').props.onPress());expect(tree.root.findAllByType(PageAction).every(a=>a.props.singleLine)).toBe(true);});


it.each([
  { returnToTeam: false, destination: 'creator/page' },
  { returnToTeam: true, destination: 'creator/page-team' },
])('Back reuses the existing $destination without leaving a duplicate behind', async ({ returnToTeam, destination }) => {
  startStack([
    { name: 'community/[id]', key: 'community', params: { id: 'community-id' } },
    { name: destination, key: 'existing-manager', params: { id: 'page' } },
    { name: 'creator/page-edit', key: 'editor', params: { id: 'page', mode: 'approved' } },
  ]);
  await mount({ returnToTeam });
  act(() => tree.root.findByType(PageFrame).props.onBack());
  expect(mockDismissTo).toHaveBeenCalledWith(`/${destination}?id=page`);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(stackKeys()).toEqual(['community', 'existing-manager']);
  expect(mockStackState!.routes.at(-1)!.params).toEqual({ id: 'page' });
  const previous = stackRouter.getStateForAction(mockStackState!, StackActions.pop(1), stackOptions)!;
  expect(previous.routes.map(route => route.key)).toEqual(['community']);
});

it.each([
  { returnToTeam: false, destination: 'creator/page' },
  { returnToTeam: true, destination: 'creator/page-team' },
])('direct-entry Back replaces the editor with $destination using the requested page', async ({ returnToTeam, destination }) => {
  startStack([{ name: 'creator/page-edit', key: 'direct-editor', params: { id: 'page', mode: 'approved' } }]);
  await mount({ returnToTeam });
  act(() => tree.root.findByType(PageFrame).props.onBack());
  expect(mockStackState!.routes).toHaveLength(1);
  expect(mockStackState!.routes[0]).toMatchObject({ name: destination, params: { id: 'page' } });
  expect(mockStackState!.routes[0].key).not.toBe('direct-editor');
  expect(mockReplace).not.toHaveBeenCalled();
});

it('Preview Back returns to the same editor before Edit Back pops to its existing manager', async () => {
  startStack([
    { name: 'community/[id]', key: 'community', params: { id: 'community-id' } },
    { name: 'creator/page', key: 'existing-manager', params: { id: 'page' } },
    { name: 'creator/page-edit', key: 'editor', params: { id: 'page', mode: 'approved' } },
  ]);
  await mount();
  act(() => field('Name').props.onChange('Keep our Sunday'));
  await act(async () => action('Preview changes').props.onPress());
  expect(tree.root.findByType(PageFrame).props.title).toBe('Page preview');
  act(() => tree.root.findByType(PageFrame).props.onBack());
  expect(tree.root.findByType(PageFrame).props.title).toBe('Edit your page');
  expect(field('Name').props.value).toBe('Keep our Sunday');
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(stackKeys()).toEqual(['community', 'existing-manager', 'editor']);
  act(() => tree.root.findByType(PageFrame).props.onBack());
  expect(stackKeys()).toEqual(['community', 'existing-manager']);
});

it.each([
  { returnToTeam: false, destination: 'creator/page' },
  { returnToTeam: true, destination: 'creator/page-team' },
])('confirmed publication pops to the existing $destination', async ({ returnToTeam, destination }) => {
  startStack([
    { name: 'community/[id]', key: 'community', params: { id: 'community-id' } },
    { name: destination, key: 'existing-manager', params: { id: 'page' } },
    { name: 'creator/page-edit', key: 'editor', params: { id: 'page', mode: 'approved' } },
  ]);
  await mount({ returnToTeam });
  await act(async () => action('Preview changes').props.onPress());
  await act(async () => action('Publish changes').props.onPress());
  expect(mockDismissTo).toHaveBeenCalledTimes(1);
  expect(stackKeys()).toEqual(['community', 'existing-manager']);
});

it.each(['Check status', 'Retry original'])('%s returns a confirmed publication to the existing delegate team', async (title) => {
  pendingPublication();
  startStack([
    { name: 'creator/page', key: 'owner-manager', params: { id: 'page' } },
    { name: 'creator/page-team', key: 'existing-team', params: { id: 'page' } },
    { name: 'creator/page-edit', key: 'editor', params: { id: 'page', mode: 'approved' } },
  ]);
  mockCheck.mockResolvedValue({ draft: { ...data.draft, pending: undefined }, receipt: { action: 'publish', version: 0, published_version: 0 }, active: false });
  await mount({ returnToTeam: true });
  await act(async () => action(title).props.onPress());
  expect(mockDismissTo).toHaveBeenCalledWith('/creator/page-team?id=page');
  expect(stackKeys()).toEqual(['owner-manager', 'existing-team']);
  if (title === 'Retry original') expect(mockDispatch.mock.calls[0][0].pending.requestId).toBe('original-publish');
  else expect(mockDispatch).not.toHaveBeenCalled();
});

it.each(['Check status', 'Retry original'])('a stale %s result cannot navigate', async (title) => {
  pendingPublication();
  const wait = deferred<any>();
  (title === 'Check status' ? mockCheck : mockDispatch).mockReturnValueOnce(wait.promise);
  await mount({ returnToTeam: true });
  act(() => action(title).props.onPress());
  mockCurrent = false;
  await act(async () => wait.resolve({ draft: data.draft, receipt: { action: 'publish', version: 0, published_version: 0 }, active: false }));
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('a publication confirmed after the local deadline does not navigate', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
  const wait = deferred<any>();
  await mount();
  await act(async () => action('Preview changes').props.onPress());
  mockDispatch.mockReturnValueOnce(wait.promise);
  act(() => action('Publish changes').props.onPress());
  await act(async () => jest.advanceTimersByTimeAsync(25001));
  await act(async () => wait.resolve({ draft: data.draft, receipt: { action: 'publish', version: 1, published_version: 1 } }));
  expect(mockDismissTo).not.toHaveBeenCalled();
});

it('Back stays put during an unresolved publication', async () => {
  const wait = deferred<any>();
  await mount();
  await act(async () => action('Preview changes').props.onPress());
  mockDispatch.mockReturnValueOnce(wait.promise);
  act(() => action('Publish changes').props.onPress());
  act(() => tree.root.findByType(PageFrame).props.onBack());
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(tree.root.findByType(PageFrame).props.title).toBe('Page preview');
  await act(async () => wait.resolve({ draft: data.draft, receipt: { action: 'publish', version: 1, published_version: 1 } }));
  expect(mockDismissTo).toHaveBeenCalledTimes(1);
});

it('allows incomplete community draft saving but blocks Preview and preserves the live page',async()=>{
 data.draft.content={...content,discovery_area:null,categories:[]};await mount();expect(field('City')).toBeUndefined();
 await act(async()=>action('Preview changes').props.onPress());expect(mockDispatch).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('Choose an area in LA');expect(JSON.stringify(tree.toJSON())).toContain('Choose one or two categories');
 await act(async()=>action('Save draft').props.onPress());expect(mockDispatch).toHaveBeenCalledTimes(1);expect(mockDispatch.mock.calls[0][1]).toBe('save');
 expect(mockDispatch.mock.calls[0][0].content).toMatchObject({discovery_area:null,categories:[]});expect(mockDismissTo).not.toHaveBeenCalled();
});
it('saves the selected area and categories then shows them in private preview',async()=>{
 await mount();act(()=>tree.root.findByType(CommunityClassificationFields).props.onAreaChange('Many places around LA'));
 act(()=>tree.root.findByType(CommunityClassificationFields).props.onCategoriesChange(['food and drink','just for fun']));
 await act(async()=>action('Preview changes').props.onPress());
 expect(mockDispatch.mock.calls[0][0].content).toMatchObject({discovery_area:'Many places around LA',categories:['food and drink','just for fun']});
 expect(JSON.stringify(tree.toJSON())).toContain('Food and drink · Just for fun');
});
it('keeps organization City and ignores absent community classification',async()=>{
 data.state.page_kind='organization';data.draft.content={...content,discovery_area:null,categories:null};await mount();
 expect(tree.root.findAllByType(CommunityClassificationFields)).toHaveLength(0);expect(field('City')).toBeDefined();
 await act(async()=>action('Preview changes').props.onPress());expect(mockDispatch).toHaveBeenCalledTimes(1);
});
it('revalidates publication and returns to a missing category if a recovered preview is incomplete',async()=>{
 mockDispatch.mockImplementationOnce(async(d:any)=>({draft:{...d,baseVersion:1,content:{...d.content,categories:[]}},receipt:{version:1,published_version:0}}));
 await mount();await act(async()=>action('Preview changes').props.onPress());await act(async()=>action('Publish changes').props.onPress());
 expect(mockDispatch).toHaveBeenCalledTimes(1);expect(action('Preview changes')).toBeDefined();expect(JSON.stringify(tree.toJSON())).toContain('Choose one or two categories');expect(mockDismissTo).not.toHaveBeenCalled();
});
it('reveals a missing category after a valid area without opening another screen',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','queueMicrotask']});data.draft.content={...content,categories:[],description:'x'.repeat(5001)};await mount();
 const scrollTo=jest.fn();tree.root.findByType(PageFrame).props.scrollRef.current={scrollTo};
 act(()=>tree.root.findByType(CommunityClassificationFields).props.categoryGuidance.onLayout({nativeEvent:{layout:{y:730}}}));
 await act(async()=>action('Preview changes').props.onPress());await act(async()=>jest.advanceTimersByTimeAsync(32));
 expect(scrollTo).toHaveBeenCalledWith({y:714,animated:false});expect(mockDispatch).not.toHaveBeenCalled();
});
it('ignores a retained classification change after the approved-page account retires',async()=>{
 await mount();const change=tree.root.findByType(CommunityClassificationFields).props.onCategoriesChange;mockCurrent=false;
 act(()=>change(['music']));expect(mockPersist).not.toHaveBeenCalled();
});
it('still requires the existing base fields when saving an approved-page draft',async()=>{
 data.draft.content={...content,name:'',discovery_area:null,categories:[]};await mount();
 await act(async()=>action('Save draft').props.onPress());expect(mockDispatch).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('Name needs');expect(JSON.stringify(tree.toJSON())).not.toContain('Choose an area in LA');
});
it('repairs only a blank private community City with the known LA launch city, leaving Area unselected',async()=>{
 data.draft.content={...content,city:'',discovery_area:null,categories:[]};await mount();
 expect(tree.root.findByType(CommunityClassificationFields).props.area).toBeNull();
 await act(async()=>action('Save draft').props.onPress());expect(mockDispatch.mock.calls[0][0].content).toMatchObject({city:'Los Angeles',discovery_area:null,categories:[]});
});
it('keeps an unresolved original community attempt byte-for-byte even with a blank City',async()=>{
 const original={...content,city:'',discovery_area:null,categories:[]};data.draft.content=original;
 data.draft.pending={requestId:'original',action:'save',expectedVersion:0,content:original};await mount();
 await act(async()=>action('Retry original').props.onPress());expect(mockDispatch.mock.calls[0][0].content).toEqual(original);expect(mockDispatch.mock.calls[0][0].pending.content).toEqual(original);
});


it.each(['save','type'] as const)('keeps committed approved %s usable during a suspended other-page render',async mode=>{
 const never=new Promise(()=>{});function Pending({suspend}:{suspend:boolean}){if(suspend)throw never;return null;}
 const render=(suspend:boolean)=><React.Suspense fallback={null}><ApprovedPageEditorScreen pageId={suspend?'other-page':'page'}/><Pending suspend={suspend}/></React.Suspense>;
 mockScopesByPage={'approved-edit:page':mockScope,'approved-edit:other-page':{userId:'creator',isCurrent:()=>true}};
 await act(async()=>{tree=create(render(false));});
 const name=field('Name'),type=name.props.onChange,save=action('Save draft').props.onPress;
 await act(async()=>{React.startTransition(()=>tree.update(render(true)));});
 expect(field('Name')).toBe(name);expect(action('Save draft').props.onPress).toBe(save);
 if(mode==='save'){
  await act(async()=>save());expect(mockDispatch).toHaveBeenCalledTimes(1);expect(mockDispatch.mock.calls[0][0].pageId).toBe('page');
 }else{
  await act(async()=>type('Committed name survives speculation'));
  expect(mockPersist).toHaveBeenCalledTimes(1);expect(mockPersist.mock.calls[0][0]).toMatchObject({pageId:'page',content:{name:'Committed name survives speculation'}});
  expect(field('Name').props.value).toBe('Committed name survives speculation');
  await act(async()=>type('Old callback must not overwrite'));
  expect(mockPersist).toHaveBeenCalledTimes(1);expect(field('Name').props.value).toBe('Committed name survives speculation');
 }
});

it.each([false,true])('allows initial account-error Back without a write, team=%s',async returnToTeam=>{
 mockAccountError=Error('Account unavailable');await mount({returnToTeam});
 act(()=>tree.root.findByType(PageFrame).props.onBack());
 expect(mockDismissTo).toHaveBeenCalledWith(`/creator/${returnToTeam?'page-team':'page'}?id=page`);
 expect(mockLoad).not.toHaveBeenCalled();expect(mockPersist).not.toHaveBeenCalled();expect(mockDispatch).not.toHaveBeenCalled();
});
it.each(['page','scope','unmount'] as const)('retires retained account-error Back after committed %s change',async change=>{
 mockAccountError=Error('Account unavailable');await mount();const back=tree.root.findByType(PageFrame).props.onBack;
 if(change==='page')await act(async()=>tree.update(<ApprovedPageEditorScreen pageId="other-page"/>));
 else if(change==='scope'){mockAccountError=null;await act(async()=>tree.update(<ApprovedPageEditorScreen pageId="page"/>));}
 else act(()=>tree.unmount());
 act(()=>back());expect(mockDismissTo).not.toHaveBeenCalled();
});


it.each(['blur','focus-roundtrip','epoch','synchronous-auth'] as const)('retires null-scope Back on %s ownership change',async change=>{
 mockAccountError=Error('Account unavailable');await mount();const back=tree.root.findByType(PageFrame).props.onBack;
 if(change==='synchronous-auth')mockCurrent=false;
 else if(change==='epoch'){mockEpoch++;await act(async()=>tree.update(<ApprovedPageEditorScreen pageId="page"/>));}
 else{mockFocused=false;await act(async()=>tree.update(<ApprovedPageEditorScreen pageId="page"/>));if(change==='focus-roundtrip'){mockFocused=true;await act(async()=>tree.update(<ApprovedPageEditorScreen pageId="page"/>));}}
 act(()=>back());expect(mockDismissTo).not.toHaveBeenCalled();
});

it.each(['community','organization'] as const)('remeasures approved %s copy through mounted font changes while retaining native inputs and page controls',async kind=>{
 const rn=require('react-native');let scale=1;const listeners=new Set<(value:number)=>void>();
 const dimensions=jest.spyOn(rn,'useWindowDimensions').mockImplementation(()=>{const [fontScale,setScale]=React.useState(scale);React.useEffect(()=>{listeners.add(setScale);return()=>{listeners.delete(setScale)};},[]);return{width:390,height:844,scale:3,fontScale};});
 try{
  data.state.page_kind=kind;await mount();
  const frame=tree.root.findByType(PageFrame),inputs=tree.root.findAllByType(rn.TextInput),values=inputs.map(n=>n.props.value);
  const actions=tree.root.findAllByType(PageAction),initialBack=frame.props.onBack;
  const expected=['Make it yours','Your page stays live as it is. Preview your changes, then publish when you’re ready.','Name','What brings people together?','Page photo','Give people a feel for your page.','About',`${content.purpose.length}/140`];
  if(kind==='organization')expected.push('City');
  const leaves=()=>expected.map(value=>tree.root.findAllByType(rn.Text).find(n=>n.props.children===value||Array.isArray(n.props.children)&&n.props.children.join('')===value)!);
  let previous=leaves();expect(previous.every(Boolean)).toBe(true);
  for(const next of [1.353,1]){
   await act(async()=>{scale=next;listeners.forEach(update=>update(next));});
   const current=leaves();current.forEach((node,index)=>{expect(node).not.toBe(previous[index]);expect(node.props.numberOfLines).toBeUndefined();});
   expect(tree.root.findByType(PageFrame)).toBe(frame);
   tree.root.findAllByType(rn.TextInput).forEach((input,index)=>{expect(input).toBe(inputs[index]);expect(input.props.value).toBe(values[index]);});
   tree.root.findAllByType(PageAction).forEach((action,index)=>expect(action).toBe(actions[index]));
   expect(mockPersist).not.toHaveBeenCalled();expect(mockDispatch).not.toHaveBeenCalled();expect(mockPick).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();
   previous=current;
  }
  act(()=>initialBack());expect(mockDismissTo).toHaveBeenCalledWith('/creator/page?id=page');
 }finally{dimensions.mockRestore();}
});
it('remeasures an existing account error while retaining controls and its original guarded Back callback',async()=>{
 const rn=require('react-native');let scale=1;const listeners=new Set<(value:number)=>void>();
 const dimensions=jest.spyOn(rn,'useWindowDimensions').mockImplementation(()=>{const [fontScale,setScale]=React.useState(scale);React.useEffect(()=>{listeners.add(setScale);return()=>{listeners.delete(setScale)};},[]);return{width:390,height:844,scale:3,fontScale};});
 try{
  mockAccountError=Error('Account unavailable');await mount({returnToTeam:true});
  const frame=tree.root.findByType(PageFrame),back=frame.props.onBack,retry=action('Try again'),press=retry.props.onPress;
  const error=()=>tree.root.findAllByType(rn.Text).find(n=>n.props.children==='Couldn’t check your account.')!;let previous=error();expect(previous).toBeDefined();
  for(const next of [1.353,1]){await act(async()=>{scale=next;listeners.forEach(update=>update(next));});expect(error()).not.toBe(previous);expect(error().props.accessibilityRole).toBe('alert');expect(error().props.numberOfLines).toBeUndefined();expect(action('Try again')).toBe(retry);previous=error();}
  expect(mockLoad).not.toHaveBeenCalled();expect(mockPersist).not.toHaveBeenCalled();expect(mockDispatch).not.toHaveBeenCalled();act(()=>back());expect(mockDismissTo).toHaveBeenCalledWith('/creator/page-team?id=page');
 }finally{dimensions.mockRestore();}
});
