import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockRead=jest.fn(),mockSave=jest.fn(),mockVerify=jest.fn();
jest.mock('../../lib/topicComposerDraft',()=>({...jest.requireActual('../../lib/topicComposerDraft'),verifyTopicComposerTarget:(...a:any[])=>mockVerify(...a),readTopicComposer:(...a:any[])=>mockRead(...a),saveTopicComposer:(...a:any[])=>mockSave(...a)}));
import {useTopicComposerDraft} from '../useTopicComposerDraft';
import {emptyTopicComposer} from '../../lib/topicComposerDraft';
let hook:ReturnType<typeof useTopicComposerDraft>,tree:ReactTestRenderer,live:boolean;const owner={userId:'53000000-0000-4000-8000-000000000001',isCurrent:()=>live};const topic='52000000-0000-4000-8000-000000000001';
function Harness({scope=owner,room=topic}:any){hook=useTopicComposerDraft(room,scope);return null;}
beforeEach(()=>{jest.clearAllMocks();live=true;mockRead.mockResolvedValue({draft:emptyTopicComposer(),unsaved:false});mockSave.mockResolvedValue(undefined);mockVerify.mockResolvedValue(undefined);});
afterEach(()=>act(()=>tree?.unmount()));
it('returns restored text before enabling composition and preserves edit identity',async()=>{mockRead.mockResolvedValue({draft:{...emptyTopicComposer(),text:'Still editing',edit:{id:topic,body:'Original',edited_at:null}},unsaved:false});await act(async()=>{tree=create(<Harness/>);});expect(hook!.ready).toBe(true);expect(hook!.draft.edit?.id).toBe(topic);expect(hook!.draft.text).toBe('Still editing');});
it('persists the original attempt before allowing transport and retains newer typing on confirmation',async()=>{await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook!.change({text:'First'}));let original:any;await act(async()=>{original=await hook!.prepare();});expect(mockSave.mock.calls.at(-1)[2].attempt).toEqual(original);await act(async()=>hook!.change({text:'Newer'}));await act(async()=>hook!.finish(original));expect(hook!.draft.text).toBe('Newer');expect(hook!.draft.attempt).toBeNull();});
it('failed initial storage read leaves draft recovery visible and send disabled',async()=>{mockRead.mockRejectedValueOnce(Error('Unavailable'));await act(async()=>{tree=create(<Harness/>);});expect(hook!.ready).toBe(false);expect(hook!.error).toBe(true);await expect(hook!.prepare()).rejects.toThrow();await act(async()=>hook!.retry());expect(hook!.ready).toBe(true);});
it('retired account cannot write a captured draft callback',async()=>{await act(async()=>{tree=create(<Harness/>);});const change=hook!.change;live=false;act(()=>change({text:'Late account text'}));expect(mockSave).not.toHaveBeenCalled();});
it('a late old-account read cannot replace the current draft',async()=>{let finish!:(x:any)=>void;mockRead.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>{tree=create(<Harness/>);});const other={...owner,userId:topic};await act(async()=>tree.update(<Harness scope={other}/>));await act(async()=>finish({draft:{...emptyTopicComposer(),text:'Private old draft'},unsaved:false}));expect(hook!.draft.text).toBe('');});

it('a changed target refused before dispatch keeps its text and editable context without an uncertain attempt',async()=>{
 const edit={id:topic,body:'Original',edited_at:null};
 await act(async()=>{tree=create(<Harness/>);});
 await act(async()=>hook!.change({text:'My revision',edit}));
 mockVerify.mockRejectedValueOnce(Error('Original changed'));
 await act(async()=>{await expect(hook!.prepare()).rejects.toThrow('Original changed');});
 expect(hook!.draft).toMatchObject({text:'My revision',edit,attempt:null});
 expect(mockSave.mock.calls.every(c=>c[2].attempt===null)).toBe(true);
 await act(async()=>hook!.change({edit:null}));
 expect(hook!.draft).toMatchObject({text:'My revision',edit:null,attempt:null});
});
it('an existing uncertain attempt remains retained when a retry target might have changed',async()=>{
 const attempt={id:topic,kind:'edit' as const,text:'Attempted edit',replyId:null,edit:{id:topic,body:'Original',edited_at:null}};
 mockRead.mockResolvedValue({draft:{...emptyTopicComposer(),text:'Newer typing',attempt},unsaved:false});
 await act(async()=>{tree=create(<Harness/>);});
 mockVerify.mockRejectedValue(Error('Changed'));
 let result:any;await act(async()=>{result=await hook!.prepare();});
 expect(result).toEqual(attempt);expect(mockVerify).not.toHaveBeenCalled();
 expect(hook!.draft).toMatchObject({text:'Newer typing',attempt});
});
it('typing during new-target validation is preserved while the validated original is prepared',async()=>{
 let release!:()=>void;mockVerify.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook!.change({text:'Original'}));
 let preparing:Promise<any>;act(()=>{preparing=hook!.prepare();});
 await act(async()=>hook!.change({text:'Newer typing'}));
 await act(async()=>{release();await preparing;});
 expect(hook!.draft).toMatchObject({text:'Newer typing',attempt:{text:'Original'}});
});


it('times out initial restore without enabling an empty composer or publishing a late draft',async()=>{
 jest.useFakeTimers();try{
  let release!:(value:any)=>void;
  mockRead.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await act(async()=>{tree=create(<Harness/>);});
  await act(async()=>{jest.advanceTimersByTime(12000);});
  expect(hook!.ready).toBe(false);expect(hook!.error).toBe(true);
  act(()=>hook!.change({text:'Must not replace unread draft'}));expect(mockSave).not.toHaveBeenCalled();
  mockRead.mockResolvedValueOnce({draft:{...emptyTopicComposer(),text:'Recovered'},unsaved:false});
  await act(async()=>{await hook!.retry();});
  await act(async()=>release({draft:{...emptyTopicComposer(),text:'Late'},unsaved:false}));
  expect(hook!.draft.text).toBe('Recovered');expect(hook!.error).toBe(false);
 }finally{jest.useRealTimers();}
});
it.each([topic,{kind:'main',id:topic},{kind:'reply',id:topic}])('bounds preparation storage for %j without dispatching or changing its original UUID',async room=>{
 jest.useFakeTimers();try{
  await act(async()=>{tree=create(<Harness room={room}/>);});await act(async()=>hook!.change({text:'Original'}));
  let release!:()=>void;mockSave.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  let prepared:Promise<any>;const dispatch=jest.fn();
  act(()=>{prepared=hook!.prepare().then(dispatch);});
  const failure=expect(prepared!).rejects.toThrow('took too long');
  await act(async()=>{await jest.advanceTimersByTimeAsync(12000);await failure;});
  const attempt=hook!.draft.attempt;expect(attempt).toMatchObject({text:'Original'});expect(hook!.error).toBe(true);
  await expect(hook!.prepare()).rejects.toThrow('Check your saved message');
  await act(async()=>release());expect(dispatch).not.toHaveBeenCalled();expect(hook!.draft.attempt).toEqual(attempt);
  mockRead.mockResolvedValueOnce({draft:hook!.draft,unsaved:false});await act(async()=>{await hook!.retry();});
  let retried:any;await act(async()=>{retried=await hook!.prepare();});expect(retried.id).toBe(attempt!.id);
 }finally{jest.useRealTimers();}
});
it('bounds post-confirmation storage without restoring a sent attempt or overwriting newer typing',async()=>{
 jest.useFakeTimers();try{
  await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook!.change({text:'Sent'}));
  let original:any;await act(async()=>{original=await hook!.prepare();});
  let release!:()=>void;mockSave.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  let finishing:Promise<void>;act(()=>{finishing=hook!.finish(original);});
  await act(async()=>{jest.advanceTimersByTime(12000);await finishing!;});
  expect(hook!.draft.attempt).toBeNull();expect(hook!.error).toBe(true);
  mockRead.mockResolvedValueOnce({draft:hook!.draft,unsaved:false});await act(async()=>{await hook!.retry();});
  await act(async()=>hook!.change({text:'Newer typing'}));await act(async()=>release());
  expect(hook!.draft).toMatchObject({text:'Newer typing',attempt:null});expect(hook!.error).toBe(false);
 }finally{jest.useRealTimers();}
});


it('keeps real per-room storage writes ordered through timeout and explicit same-UUID recovery',async()=>{
 jest.useFakeTimers();try{
  const actual=jest.requireActual('../../lib/topicComposerDraft');
  const storage=require('@react-native-async-storage/async-storage');
  mockSave.mockImplementation(actual.saveTopicComposer);mockRead.mockImplementation(actual.readTopicComposer);
  const room={kind:'main',id:'52000000-0000-4000-8000-000000000009'};
  await act(async()=>{tree=create(<Harness room={room}/>);});await act(async()=>hook!.change({text:'Original queued message'}));
  const normalSet=storage.setItem.getMockImplementation();let release!:()=>void;
  storage.setItem.mockImplementationOnce((key:string,value:string)=>new Promise<void>(resolve=>{release=()=>{normalSet(key,value);resolve();};}));
  const dispatch=jest.fn();let preparing!:Promise<any>;
  act(()=>{preparing=hook!.prepare().then(dispatch);});const failed=expect(preparing).rejects.toThrow('took too long');
  await act(async()=>{for(let i=0;i<8;i++)await Promise.resolve();});
  const beforeQueuedCalls=storage.setItem.mock.calls.length;
  await act(async()=>hook!.change({text:'Newer queued text'}));
  await act(async()=>{await jest.advanceTimersByTimeAsync(12000);await failed;});
  const original=hook!.draft.attempt;expect(original).toMatchObject({text:'Original queued message'});expect(hook!.error).toBe(true);
  let retry!:Promise<void>;act(()=>{retry=hook!.retry();});
  await act(async()=>{await jest.advanceTimersByTimeAsync(12000);await retry;});
  expect(storage.setItem.mock.calls).toHaveLength(beforeQueuedCalls);expect(dispatch).not.toHaveBeenCalled();
  await act(async()=>{release();for(let i=0;i<15;i++)await Promise.resolve();});
  expect(hook!.error).toBe(true);expect(hook!.draft).toMatchObject({text:'Newer queued text',attempt:original});
  await act(async()=>{await hook!.retry();});expect(hook!.error).toBe(false);
  let next:any;await act(async()=>{next=await hook!.prepare();});expect(next.id).toBe(original!.id);
  expect((await actual.readTopicComposer(room,owner)).draft).toMatchObject({text:'Newer queued text',attempt:original});
 }finally{jest.useRealTimers();}
});

it.each([topic,{kind:'main',id:topic}])('detaches %j before storage finishes and keeps identical next text after confirmation',async room=>{
 await act(async()=>{tree=create(<Harness room={room}/>);});await act(async()=>hook.change({text:'Hello'}));
 let release!:()=>void;mockSave.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 let preparing!:Promise<any>;const send=jest.fn();
 act(()=>{preparing=hook.prepare({detachText:true}).then(value=>{send();return value;});});
 await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});
 expect(hook.draft.text).toBe('');expect(hook.draft.attempt?.text).toBe('Hello');expect(send).not.toHaveBeenCalled();
 await act(async()=>hook.change({text:'Hello'}));
 let original:any;await act(async()=>{release();original=await preparing;});
 mockRead.mockResolvedValueOnce({draft:JSON.parse(JSON.stringify(hook.draft)),unsaved:false});await act(async()=>hook.retry());
 await act(async()=>hook.finish(original));expect(hook.draft.text).toBe('Hello');expect(hook.draft.attempt).toBeNull();
});

it('keeps identically retyped text while reply validation is pending without clearing native input',async()=>{
 let release!:()=>void;mockVerify.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook.change({text:'Hello',reply:{id:topic,body:'Parent',sender_name:'Amelia'}}));
 const clear=jest.fn();let preparing!:Promise<any>;
 act(()=>{preparing=hook.prepare({detachText:true,onDetach:clear});});
 await act(async()=>hook.change({text:'Hello'}));
 let original:any;await act(async()=>{release();original=await preparing;});
 expect(clear).not.toHaveBeenCalled();
 await act(async()=>hook.finish(original));expect(hook.draft.text).toBe('Hello');
});


it.each(['resolve', 'reject'])('a delayed draft re-read cannot replace or disable newer typing (%s)', async outcome => {
 await act(async () => { tree = create(<Harness/>); });
 await act(async () => hook.change({text: 'Saved earlier'}));
 let resolve!:(value:any)=>void, reject!:(error:Error)=>void;
 mockRead.mockImplementationOnce(() => new Promise((yes,no) => {resolve=yes;reject=no;}));
 let reading!:Promise<void>;
 await act(async () => {reading=hook.retry(); await Promise.resolve();});
 await act(async () => hook.change({text: 'New writing while storage reads'}));
 await act(async () => {
  if(outcome==='resolve') resolve({draft:{...emptyTopicComposer(),text:'Saved earlier'},unsaved:false});
  else reject(Error('Old read failed'));
  await reading;
 });
 expect(hook.draft.text).toBe('New writing while storage reads');
 expect(hook.error).toBe(false);
 expect(hook.ready).toBe(true);
});
it('a delayed re-read cannot resurrect an attempt after confirmation', async () => {
 await act(async () => {tree=create(<Harness/>);});
 await act(async () => hook.change({text:'Original'}));
 let original:any; await act(async () => {original=await hook.prepare({detachText:true});});
 const oldDraft=hook.draft;
 let resolve!:(value:any)=>void;
 mockRead.mockImplementationOnce(() => new Promise(yes => {resolve=yes;}));
 let reading!:Promise<void>; await act(async () => {reading=hook.retry();await Promise.resolve();});
 await act(async () => hook.finish(original));
 await act(async () => {resolve({draft:oldDraft,unsaved:false});await reading;});
 expect(hook.draft.attempt).toBeNull();
 expect(hook.draft.text).toBe('');
});
it('an older confirmation-cleanup failure cannot disable a newer successfully saved draft', async () => {
 await act(async () => {tree=create(<Harness/>);});
 await act(async () => hook.change({text:'Original'}));
 let original:any;await act(async () => {original=await hook.prepare({detachText:true});});
 let reject!:(error:Error)=>void;
 mockSave.mockImplementationOnce(() => new Promise((_yes,no) => {reject=no;}));
 let finishing!:Promise<void>;act(() => {finishing=hook.finish(original);});
 await act(async () => hook.change({text:'Saved next message'}));
 await act(async () => {reject(Error('Earlier cleanup failed'));await finishing;});
 expect(hook.draft).toMatchObject({text:'Saved next message',attempt:null});
 expect(hook.error).toBe(false);
});
