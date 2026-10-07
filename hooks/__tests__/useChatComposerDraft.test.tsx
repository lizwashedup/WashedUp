import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockRead=jest.fn(),mockSave=jest.fn(),mockVerify=jest.fn();
jest.mock('../../lib/chatComposerDraft',()=>({...jest.requireActual('../../lib/chatComposerDraft'),verifyChatComposerTarget:(...a:any[])=>mockVerify(...a),readChatComposer:(...a:any[])=>mockRead(...a),saveChatComposer:(...a:any[])=>mockSave(...a)}));
import {useChatComposerDraft} from '../useChatComposerDraft';
import {emptyChatComposer} from '../../lib/chatComposerDraft';
let hook:ReturnType<typeof useChatComposerDraft>,tree:ReactTestRenderer,live:boolean;const owner={userId:'53000000-0000-4000-8000-000000000001',isCurrent:()=>live};const topic='52000000-0000-4000-8000-000000000001';
const room={kind:'event' as const,id:topic};
jest.mock('expo-router',()=>({useFocusEffect:()=>{}}));
function Harness({scope=owner}:any){hook=useChatComposerDraft(room,scope);return null;}
beforeEach(()=>{jest.clearAllMocks();live=true;mockRead.mockResolvedValue({draft:emptyChatComposer(),unsaved:false});mockSave.mockResolvedValue(undefined);mockVerify.mockResolvedValue(undefined);});
afterEach(()=>act(()=>tree?.unmount()));
it('returns restored text before enabling composition and preserves edit identity',async()=>{mockRead.mockResolvedValue({draft:{...emptyChatComposer(),text:'Still editing',edit:{id:topic,content:'Original'}},unsaved:false});await act(async()=>{tree=create(<Harness/>);});expect(hook!.ready).toBe(true);expect(hook!.draft.edit?.id).toBe(topic);expect(hook!.draft.text).toBe('Still editing');});
it('persists the original attempt before allowing transport and retains newer typing on confirmation',async()=>{await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook!.change({text:'First'}));let original:any;await act(async()=>{original=await hook!.prepare();});expect(mockSave.mock.calls.at(-1)[2].attempt).toEqual(original);await act(async()=>hook!.change({text:'Newer'}));await act(async()=>hook!.finish(original));expect(hook!.draft.text).toBe('Newer');expect(hook!.draft.attempt).toBeNull();});
it('failed initial storage read leaves draft recovery visible and send disabled',async()=>{mockRead.mockRejectedValueOnce(Error('Unavailable'));await act(async()=>{tree=create(<Harness/>);});expect(hook!.ready).toBe(false);expect(hook!.error).toBe(true);await expect(hook!.prepare()).rejects.toThrow();await act(async()=>hook!.retry());expect(hook!.ready).toBe(true);});
it('retired account cannot write a captured draft callback',async()=>{await act(async()=>{tree=create(<Harness/>);});const change=hook!.change;live=false;act(()=>change({text:'Late account text'}));expect(mockSave).not.toHaveBeenCalled();});
it('a late old-account read cannot replace the current draft',async()=>{let finish!:(x:any)=>void;mockRead.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>{tree=create(<Harness/>);});const other={...owner,userId:topic};await act(async()=>tree.update(<Harness scope={other}/>));await act(async()=>finish({draft:{...emptyChatComposer(),text:'Private old draft'},unsaved:false}));expect(hook!.draft.text).toBe('');});

it('a changed target refused before dispatch keeps its text and editable context without an uncertain attempt',async()=>{
 const edit={id:topic,content:'Original'};
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
 const attempt={id:topic,text:'Attempted edit',replyId:null,edit:{id:topic,content:'Original'}};
 mockRead.mockResolvedValue({draft:{...emptyChatComposer(),text:'Newer typing',attempt},unsaved:false});
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

it('ends an unresolved restore safely and retries without overwriting an unknown saved draft',async()=>{
 jest.useFakeTimers();
 try {
  let finish!:(value:any)=>void;
  mockRead.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>{tree=create(<Harness/>);});
  expect(hook!.ready).toBe(false);
  await act(async()=>{jest.advanceTimersByTime(12000);});
  expect(hook!.error).toBe(true);expect(hook!.ready).toBe(false);
  act(()=>hook!.change({text:'Must not overwrite stored draft'}));
  await expect(hook!.prepare()).rejects.toThrow();
  expect(mockSave).not.toHaveBeenCalled();
  mockRead.mockResolvedValueOnce({draft:{...emptyChatComposer(),text:'Recovered draft'},unsaved:false});
  await act(async()=>{await hook!.retry();});
  expect(hook!.draft.text).toBe('Recovered draft');expect(hook!.ready).toBe(true);expect(hook!.error).toBe(false);
  await act(async()=>finish({draft:{...emptyChatComposer(),text:'Late obsolete read'},unsaved:false}));
  expect(hook!.draft.text).toBe('Recovered draft');
 }finally{jest.useRealTimers();}
});

it('bounds recovery behind a stalled write while retaining the current unsaved text',async()=>{
 jest.useFakeTimers();
 try {
  await act(async()=>{tree=create(<Harness/>);});
  mockSave.mockRejectedValueOnce(Error('Storage unavailable'));
  await act(async()=>hook!.change({text:'Keep my words'}));
  expect(hook!.error).toBe(true);
  mockSave.mockImplementationOnce(()=>new Promise(()=>{}));
  let retry!:Promise<void>;act(()=>{retry=hook!.retry();});
  await act(async()=>{jest.advanceTimersByTime(12000);await retry;});
  expect(hook!.draft.text).toBe('Keep my words');expect(hook!.error).toBe(true);
  await expect(hook!.prepare()).rejects.toThrow();
  expect(mockRead).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
