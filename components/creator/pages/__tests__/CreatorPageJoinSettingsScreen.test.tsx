jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad=jest.fn(),mockPersist=jest.fn(),mockSave=jest.fn(),mockResolve=jest.fn(),mockReplace=jest.fn();
let mockLive=true,mockScope={userId:'owner',isCurrent:()=>mockLive};
const mockFonts={regular:'System',medium:'System',semibold:'System',display:'System'};
let mockScopesByPage: Record<string, typeof mockScope> | undefined;
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(pageId:string)=>({scope:mockScopesByPage?.[pageId] ?? mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:mockFonts})}));
jest.mock('../../../../lib/creatorPageJoinSettings',()=>({loadPageJoinEditor:(...a:unknown[])=>mockLoad(...a),persistPageJoinDraft:(...a:unknown[])=>mockPersist(...a),savePageJoinDraft:(...a:unknown[])=>mockSave(...a),resolvePageJoinSave:(...a:unknown[])=>mockResolve(...a),draftFromPageJoinState:(s:any)=>({pageId:s.page_id,userId:s.owner_id,baseVersion:s.version,settings:s.settings,pending:false})}));
jest.mock('expo-router',()=>({router:{dismissTo:(...args:unknown[])=>mockReplace(...args),replace:(...a:unknown[])=>mockReplace(...a)},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../ProfileButton',()=>()=>null);
import CreatorPageJoinSettingsScreen from '../CreatorPageJoinSettingsScreen';
import { PageAction, PageFrame } from '../PageFrame';
import { Field } from '../../ApplyFormKit';
let tree:ReactTestRenderer,record:any,state:any,confirmed:boolean,conflict:boolean;
const action=(title:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===title);
const text=()=>JSON.stringify(tree.toJSON());
async function mount(){await act(async()=>{tree=create(<CreatorPageJoinSettingsScreen pageId="page"/>);});}
async function press(title:string){await act(async()=>{action(title)!.props.onPress();});}
beforeEach(()=>{jest.clearAllMocks();mockScopesByPage=undefined;mockLive=true;mockScope={userId:'owner',isCurrent:()=>mockLive};confirmed=false;conflict=false;
 const settings={join_policy:'approval_required',join_welcome_message:'Hello',join_intro_question:'Introduce yourself',guidelines_url:null,join_ask_reason:false,join_ask_source:false,join_ask_rules_confirm:false,join_open_question:null};
 state={page_id:'page',owner_id:'owner',name:'Sunday Table',published:false,audience:'everyone',version:1,pending_count:2,settings};record={pageId:'page',userId:'owner',baseVersion:1,settings,pending:false};
 mockLoad.mockImplementation(async()=>({state,draft:record,confirmed,conflict}));mockPersist.mockImplementation(async r=>{record=r;});mockSave.mockImplementation(async r=>{record={...r,pending:false,baseVersion:2};state={...state,version:2,settings:r.settings};return record;});
 mockResolve.mockImplementation(async()=>{record={...record,pending:false,baseVersion:state.version};confirmed=false;return record;});
});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());});
it('shows the correct page and existing questions without inventing a membership restriction',async()=>{await mount();expect(text()).toContain('Sunday Table');expect(text()).toContain('page stays private');expect(text()).toContain('2 pending requests');expect(text()).not.toContain('Confirm membership requirements');expect(mockSave).not.toHaveBeenCalled();});
it('the review toggle edits a saved draft; only explicit Save settings writes remotely',async()=>{await mount();await act(async()=>{tree.root.findAllByProps({accessibilityLabel:'Request to join'}).find(n=>n.props.onPress)!.props.onPress();});expect(mockPersist).toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();await press('Save settings');expect(mockSave.mock.calls[0][0].settings.join_policy).toBe('open');expect(text()).toContain('Joining settings saved.');});
it('a failed save retains the exact pending draft and offers check or same-save retry',async()=>{await mount();mockSave.mockImplementationOnce(async r=>{record={...r,pending:true};throw Error('Unconfirmed');});await press('Save settings');expect(text()).toContain('last save is unconfirmed');expect(action('Check saved status')).toBeDefined();expect(action('Retry same save')).toBeDefined();expect(action('Save settings')!.props.disabled).toBe(true);expect(tree.root.findAllByType(Field).every(n=>n.props.editable===false)).toBe(true);});
it('confirmed recovery is read-only and never automatically resends',async()=>{record={...record,pending:true};confirmed=true;await mount();await press('Check saved status');expect(mockResolve).toHaveBeenCalledTimes(1);expect(mockSave).not.toHaveBeenCalled();expect(action('Save settings')!.props.disabled).toBe(false);});
it('conflict requires an explicit load of saved settings before editing',async()=>{conflict=true;record={...record,pending:true};state={...state,version:2};await mount();expect(action('Retry same save')).toBeUndefined();expect(action('Save settings')!.props.disabled).toBe(true);conflict=false;await press('Load saved');expect(mockPersist.mock.calls[0][0].baseVersion).toBe(2);expect(mockSave).not.toHaveBeenCalled();});
it('failed reads do not show an empty editable form',async()=>{mockLoad.mockRejectedValue(new Error('Unavailable'));await mount();expect(text()).toContain('Unavailable');expect(tree.root.findAllByType(Field)).toHaveLength(0);expect(action('Save settings')).toBeUndefined();});
it('leaving waits for the latest local draft and stays when storage fails',async()=>{await mount();mockPersist.mockRejectedValueOnce(new Error('Storage unavailable'));await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});expect(mockReplace).not.toHaveBeenCalled();expect(text()).toContain('Storage unavailable');});
it('another account cannot inherit the old page’s fields',async()=>{await mount();mockScope={userId:'other',isCurrent:()=>true};mockLoad.mockRejectedValue(new Error('Page unavailable for this account'));await act(async()=>{tree.update(<CreatorPageJoinSettingsScreen pageId="page"/>);});expect(text()).not.toContain('Sunday Table');expect(tree.root.findAllByType(Field)).toHaveLength(0);});

it('failed local persistence and refresh keep the newest visible edits',async()=>{await mount();mockPersist.mockRejectedValue(new Error('Storage unavailable'));await act(async()=>{tree.root.findAllByType(Field).find(n=>n.props.label==='Welcome message')!.props.onChange('Keep this newest text');});await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});expect(tree.root.findAllByType(Field).find(n=>n.props.label==='Welcome message')!.props.value).toBe('Keep this newest text');expect(mockReplace).not.toHaveBeenCalled();});

it('releases the saving indicator after a stalled save without allowing another write',async()=>{
 jest.useFakeTimers();
 try {
  await mount();mockSave.mockImplementationOnce(()=>new Promise(()=>undefined));
  await press('Save settings');
  await act(async()=>{jest.advanceTimersByTime(12001);});
  expect(tree.root.findByType(PageFrame).props.busy).toBe(false);
  expect(action('Check status')).toBeDefined();
  expect(action('Save settings')!.props.disabled).toBe(true);
  expect(mockSave).toHaveBeenCalledTimes(1);
 } finally {jest.useRealTimers();}
});

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function advance(){await act(async()=>{jest.advanceTimersByTime(12001);});}
it('keeps the original save locked during repeated status checks, then confirms without resending',async()=>{
 jest.useFakeTimers();try{
  await mount();const pending=deferred<any>();mockSave.mockImplementationOnce(r=>{record={...r,pending:true};return pending.promise;});
  await press('Save settings');await advance();await press('Check status');
  expect(text()).toContain('original action is still finishing');
  expect(action('Retry same save')).toBeUndefined();
  await press('Save settings');expect(mockSave).toHaveBeenCalledTimes(1);
  const savedDraft={...record,pending:false,baseVersion:2};
  await act(async()=>{record=savedDraft;state={...state,version:2};pending.resolve(savedDraft);});
  expect(action('Check status')).toBeDefined();expect(action('Save settings')!.props.disabled).toBe(true);
  await press('Check status');expect(action('Save settings')!.props.disabled).toBe(false);
  expect(mockSave).toHaveBeenCalledTimes(1);expect(mockResolve).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
it('late save rejection keeps the original settings and version for explicit same-save retry',async()=>{
 jest.useFakeTimers();try{
  await mount();const pending=deferred<any>();mockSave.mockImplementationOnce(r=>{record={...r,pending:true};return pending.promise;});
  await press('Save settings');const original=mockSave.mock.calls[0][0];await advance();
  await act(async()=>{pending.reject(Error('Reply lost'));});await press('Check status');
  expect(action('Retry same save')).toBeDefined();await press('Retry same save');
  expect(mockSave.mock.calls[1][0]).toEqual({...original,pending:true});
  expect(mockSave).toHaveBeenCalledTimes(2);
 }finally{jest.useRealTimers();}
});
it('a stalled Back saves only once, keeps the draft visible and never navigates on late completion',async()=>{
 jest.useFakeTimers();try{
  await mount();const pending=deferred<void>();mockPersist.mockImplementationOnce(()=>pending.promise);
  await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});await advance();
  expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(text()).toContain('check before leaving');
  await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});expect(mockPersist).toHaveBeenCalledTimes(1);
  await act(async()=>{pending.resolve();});expect(mockReplace).not.toHaveBeenCalled();
  await press('Check status');expect(text()).toContain('You can go back');expect(mockReplace).not.toHaveBeenCalled();
  await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});expect(mockReplace).toHaveBeenCalledWith('/creator/page?id=page');
 }finally{jest.useRealTimers();}
});
it('a stalled initial read exits loading and keeps recovery reachable',async()=>{
 jest.useFakeTimers();try{
  mockLoad.mockImplementationOnce(()=>new Promise(()=>undefined));await mount();await advance();
  expect(text()).not.toContain('Loading joining settings');expect(action('Try again')).toBeDefined();
  await press('Try again');expect(text()).toContain('Sunday Table');expect(action('Save settings')!.props.disabled).toBe(false);
 }finally{jest.useRealTimers();}
});
it('a status check timeout keeps pending edits locked and does not resend',async()=>{
 jest.useFakeTimers();try{
  record={...record,pending:true};await mount();mockLoad.mockImplementationOnce(()=>new Promise(()=>undefined));
  await press('Check saved status');await advance();
  expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(action('Check status')).toBeDefined();
  expect(tree.root.findAllByType(Field).every(n=>n.props.editable===false)).toBe(true);
  expect(mockSave).not.toHaveBeenCalled();expect(mockResolve).not.toHaveBeenCalled();
  await press('Check status');expect(action('Retry same save')).toBeDefined();
 }finally{jest.useRealTimers();}
});
it('permission loss during a pending save blocks retry and does not expose another account’s values',async()=>{
 jest.useFakeTimers();try{
  await mount();const pending=deferred<any>();mockSave.mockImplementationOnce(()=>pending.promise);
  await press('Save settings');await advance();mockLoad.mockRejectedValue(Error('Page unavailable for this account'));
  await press('Check status');expect(text()).toContain('Page unavailable');expect(action('Save settings')!.props.disabled).toBe(true);
  mockScope={userId:'other',isCurrent:()=>true};await act(async()=>{tree.update(<CreatorPageJoinSettingsScreen pageId="page"/>);});
  await act(async()=>{pending.resolve({...record,settings:{...record.settings,join_welcome_message:'Old account secret'}});});
  expect(text()).not.toContain('Old account secret');expect(text()).not.toContain('Sunday Table');expect(mockReplace).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
it('an unmounted Back action cannot navigate when persistence later finishes',async()=>{
 await mount();const pending=deferred<void>();mockPersist.mockImplementationOnce(()=>pending.promise);
 await act(async()=>{tree.root.findByType(PageFrame).props.onBack();});await act(async()=>{tree.unmount();});
 await act(async()=>{pending.resolve();});expect(mockReplace).not.toHaveBeenCalled();
});
it('stale callbacks cannot dispatch writes or navigation after the scope changes',async()=>{
 await mount();const oldSave=action('Save settings')!.props.onPress,oldBack=tree.root.findByType(PageFrame).props.onBack;
 mockScope={userId:'other',isCurrent:()=>true};mockLoad.mockRejectedValue(Error('Unavailable'));
 await act(async()=>{tree.update(<CreatorPageJoinSettingsScreen pageId="page"/>);});
 await act(async()=>{oldSave();oldBack();});expect(mockSave).not.toHaveBeenCalled();expect(mockPersist).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
});
it('stalled confirmed-save cleanup stays locked until its original local write settles',async()=>{
 jest.useFakeTimers();try{
  record={...record,pending:true};confirmed=true;await mount();const pending=deferred<any>();mockResolve.mockImplementationOnce(()=>pending.promise);
  await press('Check saved status');await advance();expect(action('Check status')).toBeDefined();
  await press('Check status');expect(mockResolve).toHaveBeenCalledTimes(1);expect(mockSave).not.toHaveBeenCalled();
  await act(async()=>{record={...record,pending:false};confirmed=false;pending.resolve(record);});
  await press('Check status');expect(action('Save settings')!.props.disabled).toBe(false);expect(mockResolve).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
it('a rejected save followed by a stalled refresh stops spinning and leaves edits readable',async()=>{
 jest.useFakeTimers();try{
  await mount();mockSave.mockRejectedValueOnce(Error('Save could not be confirmed'));mockLoad.mockImplementationOnce(()=>new Promise(()=>undefined));
  await press('Save settings');await advance();
  expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(text()).toContain('Save could not be confirmed');
  expect(tree.root.findAllByType(Field).find(n=>n.props.label==='Welcome message')!.props.value).toBe('Hello');
  expect(action('Try again')).toBeDefined();expect(mockSave).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});


it('retains committed save while a competing creator visit is uncommitted', async () => {
 const never = new Promise(() => {});
 function Pending({ suspend }: { suspend: boolean }) { if (suspend) throw never; return null; }
 const render = (suspend: boolean) => <React.Suspense fallback={null}><CreatorPageJoinSettingsScreen pageId={suspend ? 'other-page' : 'page'} /><Pending suspend={suspend} /></React.Suspense>;
 mockScopesByPage = { 'joining:page': mockScope, 'joining:other-page': { userId: mockScope.userId, isCurrent: () => true } };
 await act(async () => { tree = create(render(false)); });
 const save = action('Save settings')!.props.onPress;
 await act(async () => { React.startTransition(() => tree.update(render(true))); });
 expect(action('Save settings')!.props.onPress).toBe(save);
 await act(async () => save());
 expect(mockSave).toHaveBeenCalledTimes(1);
});
