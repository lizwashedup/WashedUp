// Fake request deadlines, but keep React act() scheduling live between tests.
import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockRead=jest.fn(),mockWorkspace=jest.fn(),mockSelection=jest.fn(),mockPrepare=jest.fn(),mockStart=jest.fn(),mockAcknowledge=jest.fn(),mockGetEvent=jest.fn(),mockReplace=jest.fn();
let mockCurrent=true;const mockScope={userId:'0e6e1827-0f87-4e03-b42b-7ade8219725b',isCurrent:()=>mockCurrent};
const mockListeners=new Set<(value:string)=>void>();let mockAppState='active';
jest.mock('react-native',()=>new Proxy(jest.requireActual('react-native'),{get:(target,key)=>key==='AppState'?{get currentState(){return mockAppState;},addEventListener:(_:string,fn:(v:string)=>void)=>{mockListeners?.add(fn);return{remove:()=>mockListeners?.delete(fn)};}}:Reflect.get(target,key)}));
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{viewerId:mockScope.userId,epoch:1,isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageEventReuseEntry',()=>({readPageEventReuseEntry:(...a:unknown[])=>mockRead(...a),getPageEventReuseWorkspace:(...a:unknown[])=>mockWorkspace(...a),getPageEventReuseSelection:(...a:unknown[])=>mockSelection(...a),preparePageEventReuseEntry:(...a:unknown[])=>mockPrepare(...a),startPageEventReuseEntry:(...a:unknown[])=>mockStart(...a),acknowledgePageEventReuseEntry:(...a:unknown[])=>mockAcknowledge(...a)}));
jest.mock('../../../../lib/creatorPageEventSave',()=>({getPageEventSaveState:(...a:unknown[])=>mockGetEvent(...a)}));
jest.mock('../../../../lib/creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
jest.mock('expo-router',()=>({router:{replace:(...a:unknown[])=>mockReplace(...a),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../ProfileButton',()=>()=>null);
import CreatorPageEventReuseScreen from '../CreatorPageEventReuseScreen';import {PageAction} from '../PageFrame';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fd00000-0000-4000-8000-000000000002',source={kind:'event' as const,pageId:page,eventId:'0fd00000-0000-4000-8000-000000000001'};
let tree:ReactTestRenderer,attempt:any,result:any;
const action=(name:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===name)!;
async function flush(){for(let i=0;i<6;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>{tree=create(<CreatorPageEventReuseScreen pageId={page} source={source}/>);});await flush();}
beforeEach(()=>{jest.resetAllMocks();mockCurrent=true;mockAppState='active';mockListeners.clear();attempt={version:1,userId:mockScope.userId,pageId:page,eventId:event,source,title:'Original saved story',category:'community',sourceUpdatedAt:'2026-09-15T01:00:00Z',requestId:'0fd00000-0000-4000-8000-000000000003'};result={attempt,entry:'owner',stage:'saved',saved:{eventId:event},cleanupPending:false};mockRead.mockResolvedValue(null);mockWorkspace.mockResolvedValue({entry:'owner',name:'Sunset page',events:[]});mockSelection.mockResolvedValue({title:'Selected story',category:'community',updatedAt:attempt.sourceUpdatedAt});mockPrepare.mockResolvedValue({attempt,created:true});mockStart.mockImplementation(()=>({cancel:jest.fn(),done:Promise.resolve(result)}));mockAcknowledge.mockResolvedValue(true);mockGetEvent.mockResolvedValue({pageId:page,eventId:event});});
afterEach(()=>act(()=>tree?.unmount()));
it('opens an authorized source preview without creating a draft or starting a copy',async()=>{await mount();expect(JSON.stringify(tree.toJSON())).toContain('Selected story');expect(action('Create draft')).toBeTruthy();expect(mockPrepare).not.toHaveBeenCalled();expect(mockStart).not.toHaveBeenCalled();});
it('unknown source access never offers a creation button or exposes the stored title',async()=>{mockSelection.mockRejectedValue(Error('Denied'));await mount();expect(action('Create draft')).toBeUndefined();expect(action('Check copy')).toBeTruthy();expect(JSON.stringify(tree.toJSON())).not.toContain('Selected story');});
it('a pending original is checked read-only and shown instead of the newly selected source',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'pending'};await mount();expect(mockStart.mock.calls[0][2]).toBe('check');expect(mockPrepare).not.toHaveBeenCalled();expect(mockSelection).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Original saved story');expect(action('Resume copy')).toBeTruthy();});
it('confirmation offers the saved destination; it is not acknowledged or opened automatically',async()=>{await mount();await act(async()=>{await action('Create draft').props.onPress();});expect(action('Open event')).toBeTruthy();expect(mockAcknowledge).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();});
it.each(['owner','team'])('explicit open rechecks and acknowledges the same destination for %s entry',async entry=>{result={...result,entry};await mount();await act(async()=>{await action('Create draft').props.onPress();});await act(async()=>{await action('Open event').props.onPress();});expect(mockGetEvent).toHaveBeenCalledWith(page,event,expect.objectContaining({userId:mockScope.userId}));expect(mockAcknowledge).toHaveBeenCalledWith(attempt,expect.objectContaining({userId:mockScope.userId}));expect(mockReplace).toHaveBeenCalledWith(`/creator/event-form?id=${event}&pageId=${page}${entry==='team'?'&team=1':''}`);});
it('a rapid second creation cannot prepare another destination',async()=>{await mount();let finish!:(v:any)=>void;mockPrepare.mockReturnValueOnce(new Promise(r=>{finish=r;}));const start=action('Create draft').props.onPress;let pending!:Promise<void>;await act(async()=>{pending=start();await start();});expect(mockPrepare).toHaveBeenCalledTimes(1);await act(async()=>{finish({attempt,created:true});await pending;});expect(mockStart).toHaveBeenCalledTimes(1);});
it('pausing during initial preparation prevents any later draft-copy dispatch',async()=>{await mount();let finish!:(v:any)=>void;mockPrepare.mockReturnValueOnce(new Promise(r=>{finish=r;}));let pending!:Promise<void>;await act(async()=>{pending=action('Create draft').props.onPress();});act(()=>action('Pause copy').props.onPress());expect(mockPrepare.mock.calls[0][2].isCurrent()).toBe(false);await act(async()=>{finish({attempt,created:true});await pending;});expect(mockStart).not.toHaveBeenCalled();expect(action('Check copy')).toBeTruthy();});
it('backgrounding during preparation prevents a delayed copy from starting',async()=>{await mount();let finish!:(v:any)=>void;mockPrepare.mockReturnValueOnce(new Promise(r=>{finish=r;}));let pending!:Promise<void>;await act(async()=>{pending=action('Create draft').props.onPress();});act(()=>{mockAppState='background';mockListeners.forEach(fn=>fn('background'));});await act(async()=>{finish({attempt,created:true});await pending;});expect(mockStart).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();});
it('a different pending entry discovered on tap must be checked before it can resume',async()=>{await mount();mockPrepare.mockResolvedValue({attempt,created:false});await act(async()=>{await action('Create draft').props.onPress();});expect(mockStart).not.toHaveBeenCalled();expect(action('Check copy')).toBeTruthy();expect(action('Resume copy')).toBeUndefined();});
it('unknown creation or copy results retain explicit check without automatic retry',async()=>{await mount();mockStart.mockImplementationOnce(()=>({cancel:jest.fn(),done:Promise.reject(Error('Unknown result'))}));await act(async()=>{await action('Create draft').props.onPress();});expect(action('Check copy')).toBeTruthy();expect(mockStart).toHaveBeenCalledTimes(1);await flush();expect(mockStart).toHaveBeenCalledTimes(1);});
it('retiring the page before completion prevents late navigation',async()=>{await mount();let finish!:(v:any)=>void;mockStart.mockReturnValueOnce({cancel:jest.fn(),done:new Promise(r=>{finish=r;})});let pending!:Promise<void>;await act(async()=>{pending=action('Create draft').props.onPress();});mockCurrent=false;await act(async()=>{finish(result);await pending;});expect(mockReplace).not.toHaveBeenCalled();expect(mockAcknowledge).not.toHaveBeenCalled();});

it.each(['source','destination'])('a verified %s conflict explains preservation and offers no failing Resume action',async conflict=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'conflict',conflict};await mount();expect(action('Resume copy')).toBeUndefined();expect(action('Create draft')).toBeUndefined();expect(action('Open event')).toBeUndefined();expect(action('Check copy')).toBeTruthy();expect(JSON.stringify(tree.toJSON())).toContain(conflict==='source'?'The source changed':'The destination changed');expect(mockPrepare).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();});
it('a fresh Check can recover an original saved result after an earlier conflict',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'conflict',conflict:'destination'};await mount();result={...result,stage:'saved'};await act(async()=>{await action('Check copy').props.onPress();});expect(action('Open event')).toBeTruthy();expect(mockPrepare).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();});

it.each(['owner','team'])('explicit Keep then Open preserves the same %s destination',async entry=>{mockRead.mockResolvedValue(attempt);result={...result,entry,stage:'conflict',conflict:'source'};await mount();expect(action('Keep event')).toBeTruthy();result={...result,stage:'kept',event:{fields:{title:'Preserved draft'}},attempt:{...attempt,kept:true,keeping:true}};await act(async()=>{await action('Keep event').props.onPress();});expect(mockStart.mock.calls[1][2]).toBe('keep');expect(mockPrepare).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Preserved draft');await act(async()=>{await action('Open event').props.onPress();});expect(mockReplace).toHaveBeenCalledWith(`/creator/event-form?id=${event}&pageId=${page}${entry==='team'?'&team=1':''}`);});
it('kept event exposes unfinished cleanup without offering to copy again',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'kept',event:{fields:{title:'Kept'}},cleanupPending:true};await mount();expect(action('Open event')).toBeTruthy();expect(action('Finish cleanup')).toBeTruthy();expect(action('Resume copy')).toBeUndefined();await act(async()=>{await action('Finish cleanup').props.onPress();});expect(mockStart.mock.calls[1][2]).toBe('keep');});
it('a stopped recovery can continue without preparing a new selection',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'stopping'};await mount();expect(action('Keep event')).toBeTruthy();expect(action('Resume copy')).toBeUndefined();});
it('unknown keep response never opens or claims completion',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'conflict',conflict:'destination'};await mount();mockStart.mockReturnValueOnce({cancel:jest.fn(),done:Promise.reject(Error('Offline'))});await act(async()=>{await action('Keep event').props.onPress();});expect(action('Open event')).toBeUndefined();expect(action('Check copy')).toBeTruthy();expect(mockReplace).not.toHaveBeenCalled();});

it('pausing Keep retires its operation and preserves recovery without opening',async()=>{mockRead.mockResolvedValue(attempt);result={...result,stage:'conflict',conflict:'source'};await mount();let finish!:(v:any)=>void;const cancel=jest.fn();mockStart.mockImplementationOnce(()=>({cancel,done:new Promise(r=>{finish=r;})}));let pending!:Promise<void>;await act(async()=>{pending=action('Keep event').props.onPress();});expect(action('Pause recovery')).toBeTruthy();act(()=>action('Pause recovery').props.onPress());expect(mockStart.mock.calls[1][1].isCurrent()).toBe(false);expect(cancel).toHaveBeenCalled();await act(async()=>{finish({...result,stage:'stopping'});await pending;});expect(mockReplace).not.toHaveBeenCalled();});


describe('stalled copy recovery',()=>{
 beforeEach(()=>jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
 afterEach(()=>jest.useRealTimers());
 it('a stalled initial check releases the screen for an explicit fresh check',async()=>{
  let finish!:(value:any)=>void;mockRead.mockReturnValueOnce(new Promise(r=>{finish=r;}));await mount();
  await act(async()=>{await jest.advanceTimersByTimeAsync(25_001);});
  expect(action('Check copy')?.props.disabled).toBe(false);
  await act(async()=>{await action('Check copy').props.onPress();});
  expect(action('Create draft')).toBeTruthy();
  await act(async()=>{finish(attempt);});await flush();
  expect(mockStart).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Selected story');
 });
 it('Pause is immediately usable even if preparation never answers; late preparation cannot replace a fresh check',async()=>{
  await mount();let finish!:(value:any)=>void;mockPrepare.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  act(()=>{void action('Create draft').props.onPress();});act(()=>action('Pause copy').props.onPress());await flush();
  expect(action('Check copy')?.props.disabled).toBe(false);
  await act(async()=>{await action('Check copy').props.onPress();});
  await act(async()=>{finish({attempt,created:true});});await flush();
  expect(mockStart).not.toHaveBeenCalled();expect(action('Create draft')?.props.disabled).toBe(false);
 });
 it('a timed out open never navigates when its access check arrives late',async()=>{
  await mount();await act(async()=>{await action('Create draft').props.onPress();});
  let finish!:(value:any)=>void;mockGetEvent.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  act(()=>{void action('Open event').props.onPress();});await act(async()=>{await jest.advanceTimersByTimeAsync(25_001);});
  expect(action('Check copy')?.props.disabled).toBe(false);
  await act(async()=>{finish({eventId:event});});await flush();expect(mockReplace).not.toHaveBeenCalled();expect(mockAcknowledge).not.toHaveBeenCalled();
 });
});

it('keeps a progressing copy active beyond ordinary request deadlines, and ignores progress after Pause',async()=>{
 jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });try{
  await mount();let progress!:(v:any)=>void;
  mockStart.mockImplementationOnce((_page,_scope,_action,callback)=>{progress=callback;return{cancel:jest.fn(),done:new Promise(()=>{})};});
  act(()=>{void action('Create draft').props.onPress();});await flush();
  await act(async()=>{await jest.advanceTimersByTimeAsync(26_000);});
  act(()=>progress({completed:1,total:3}));expect(JSON.stringify(tree.toJSON())).toContain('media items copied');expect(action('Pause copy')).toBeTruthy();
  act(()=>action('Pause copy').props.onPress());await flush();await act(async()=>{await action('Check copy').props.onPress();});
  act(()=>progress({completed:2,total:3}));expect(JSON.stringify(tree.toJSON())).not.toContain('media items copied');expect(action('Create draft')).toBeTruthy();
 }finally{jest.useRealTimers();}
});
it('refuses to acknowledge or open a saved event from a different page',async()=>{
 await mount();await act(async()=>{await action('Create draft').props.onPress();});mockGetEvent.mockResolvedValueOnce({eventId:event,pageId:'different-page'});
 await act(async()=>{await action('Open event').props.onPress();});expect(mockAcknowledge).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(action('Check copy')).toBeTruthy();
});
