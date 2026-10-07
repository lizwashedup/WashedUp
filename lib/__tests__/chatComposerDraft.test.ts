import {addChatMentionReference} from '../chatMentionIdentity';
const mockMemory=new Map<string,string>(),mockGet=jest.fn(),mockSet=jest.fn(),mockSession=jest.fn(),mockQuery=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(k:string)=>mockGet(k),setItem:(k:string,v:string)=>mockSet(k,v)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '51000000-0000-4000-8000-000000000001'}));
jest.mock('../blocking',()=>({getBlockedWith:async()=>new Set()}));
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:()=>{const q:any={};for(const n of ['select','eq','maybeSingle'])q[n]=()=>q;q.setHeader=()=>mockQuery();return q;}}}));
import {emptyChatComposer,readChatComposer,saveChatComposer,prepareChatComposer,finishChatComposer,checkChatComposerAttempt,verifyChatComposerTarget,type ChatComposerDraft} from '../chatComposerDraft';
const topic='52000000-0000-4000-8000-000000000001',user='53000000-0000-4000-8000-000000000001',parent='54000000-0000-4000-8000-000000000001';const room={kind:'event' as const,id:topic};let live:boolean;const owner={userId:user,isCurrent:()=>live};
beforeEach(()=>{jest.clearAllMocks();mockMemory.clear();live=true;mockGet.mockImplementation(async k=>mockMemory.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockMemory.set(k,v);});mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'test-token'}},error:null});mockQuery.mockResolvedValue({data:null,error:null});});
it('ordinary text and reply context survive a new read under the same account/topic',async()=>{const draft={...emptyChatComposer(),text:'Bring a blanket',reply:{id:parent,content:'Where shall we meet?',senderName:'Aster'}};await saveChatComposer(room,owner,draft);expect((await readChatComposer(room,owner)).draft).toEqual(draft);expect((await readChatComposer(room,{...owner,userId:parent})).draft.text).toBe('');});
it('an edit remains an edit of its exact original message on return',async()=>{const draft={...emptyChatComposer(),text:'Changed wording',edit:{id:parent,content:'Original wording'}};await saveChatComposer(room,owner,draft);const restored=(await readChatComposer(room,owner)).draft;expect(prepareChatComposer(restored)).toMatchObject({id:parent,text:'Changed wording',edit:{content:'Original wording'}});});
it('the pending original UUID and payload survive newer typing and return',async()=>{let draft={...emptyChatComposer(),text:'First message'};const attempt=prepareChatComposer(draft);const saved={...draft,text:'Later typing',attempt};await saveChatComposer(room,owner,saved);const restored=(await readChatComposer(room,owner)).draft;expect(prepareChatComposer(restored)).toEqual(attempt);expect(finishChatComposer(restored,attempt)).toEqual({...saved,attempt:null});});
it('confirmation clears only the matching original composer context',()=>{const draft={...emptyChatComposer(),text:'Hello'};const attempt=prepareChatComposer(draft);expect(finishChatComposer({...draft,attempt},attempt)).toEqual(emptyChatComposer());expect(finishChatComposer({...draft,edit:{id:parent,content:'Before'},attempt},attempt).text).toBe('Hello');});
it('reads wait for an already accepted local write after navigation',async()=>{let finish!:()=>void;mockSet.mockImplementationOnce((k,v)=>new Promise<void>(resolve=>{finish=()=>{mockMemory.set(k,v);resolve();};}));const pending=saveChatComposer(room,owner,{...emptyChatComposer(),text:'Still kept'});await Promise.resolve();await Promise.resolve();live=false;finish();await pending;live=true;expect((await readChatComposer(room,owner)).draft.text).toBe('Still kept');});
it('storage failure retains the original for explicit recovery',async()=>{mockSet.mockRejectedValueOnce(Error('Unavailable'));await expect(saveChatComposer(room,owner,{...emptyChatComposer(),text:'Keep this'})).rejects.toThrow();expect(await readChatComposer(room,owner)).toMatchObject({draft:{text:'Keep this'},unsaved:true});await saveChatComposer(room,owner,{...emptyChatComposer(),text:'Keep this'});expect((await readChatComposer(room,owner)).unsaved).toBe(false);});
it('wrong-account sessions never inspect or retry the original message',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:parent},access_token:'other'}},error:null});await expect(checkChatComposerAttempt(room,prepareChatComposer({...emptyChatComposer(),text:'Hello'}),owner)).rejects.toThrow('account');expect(mockQuery).not.toHaveBeenCalled();});
it('changed or unavailable edit targets are not overwritten',async()=>{const a=prepareChatComposer({...emptyChatComposer(),text:'New edit',edit:{id:parent,content:'Before'}});mockQuery.mockResolvedValue({data:{id:parent,user_id:user,content:'Changed elsewhere'},error:null});await expect(verifyChatComposerTarget(room,a,owner)).rejects.toThrow('changed');mockQuery.mockResolvedValue({data:null,error:null});await expect(verifyChatComposerTarget(room,a,owner)).rejects.toThrow('available');});
it('receipt checks require the original author and reply target',async()=>{const a=prepareChatComposer({...emptyChatComposer(),text:'Hello',reply:{id:parent,content:'Before',senderName:'Aster'}});mockQuery.mockResolvedValue({data:{message_type:'user',image_url:null,user_id:user,content:'Hello',reply_to_message_id:parent},error:null});expect(await checkChatComposerAttempt(room,a,owner)).toBe(true);mockQuery.mockResolvedValue({data:{message_type:'user',image_url:null,user_id:user,content:'Hello',reply_to_message_id:null},error:null});await expect(checkChatComposerAttempt(room,a,owner)).rejects.toThrow('reply');});


it.each(['session','original-message'])('returns control after a stalled %s check without discarding the edit',async stage=>{
 jest.useFakeTimers();
 const draft={...emptyChatComposer(),text:'My revised message',edit:{id:parent,content:'Before'}};
 const attempt=prepareChatComposer(draft);
 await saveChatComposer(room,owner,draft);
 const stalled=new Promise(()=>{});
 if(stage==='session')mockSession.mockReturnValueOnce(stalled);else mockQuery.mockReturnValueOnce(stalled);
 try{
  const outcome=verifyChatComposerTarget(room,attempt,owner).catch(error=>error);
  await jest.advanceTimersByTimeAsync(12_000);
  expect((await outcome).name).toBe('RequestDeadlineError');
  expect((await readChatComposer(room,owner)).draft).toEqual(draft);
  expect(mockSession).toHaveBeenCalledTimes(1);
  expect(mockQuery).toHaveBeenCalledTimes(stage==='session'?0:1);
 }finally{jest.useRealTimers();}
});

const firstAlex='cccccccc-cccc-4ccc-8ccc-cccccccccccc',secondAlex='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
it('keeps exact picked identities across storage and trims only the surrounding whitespace',async()=>{
 const text='  🌅 @Alex, hello  ';
 const mentions=addChatMentionReference(text,null,secondAlex,'Alex',5);
 const draft={...emptyChatComposer(),text,mentions};
 await saveChatComposer(room,owner,draft);
 const restored=(await readChatComposer(room,owner)).draft;
 expect(restored.mentions).toEqual(mentions);
 const attempt=prepareChatComposer(restored);
 expect(attempt.mentions).toEqual({version:1,text:'🌅 @Alex, hello',references:[{userId:secondAlex,label:'Alex',start:2,end:7}]});
 expect(attempt.mentions).not.toBe(restored.mentions);
 expect(finishChatComposer({...restored,attempt},attempt)).toEqual(emptyChatComposer());
});
it('does not erase a text-identical draft after the chosen person changes',async()=>{
 const text='@Alex, hello';
 const original=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const newer=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const attempt=prepareChatComposer({...emptyChatComposer(),text,mentions:original});
 const draft={...emptyChatComposer(),text,mentions:newer,attempt};
 await saveChatComposer(room,owner,draft);
 const restored=(await readChatComposer(room,owner)).draft;
 expect(prepareChatComposer(restored).mentions).toEqual(original);
 expect(finishChatComposer(restored,attempt)).toEqual({...draft,attempt:null});
});
it('rejects stale identity metadata in a saved composer or uncertain attempt',async()=>{
 const mentions=addChatMentionReference('@Alex',null,firstAlex,'Alex',0);
 await expect(saveChatComposer(room,owner,{...emptyChatComposer(),text:'Changed',mentions})).rejects.toThrow('kept');
 const attempt=prepareChatComposer({...emptyChatComposer(),text:'@Alex',mentions});
 await expect(saveChatComposer(room,owner,{...emptyChatComposer(),text:'@Alex',mentions,attempt:{...attempt,text:'Changed'}})).rejects.toThrow('kept');
});
it('requires the stored identity as well as the text to confirm an uncertain send',async()=>{
 const text='@Alex, hello';
 const mentions=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const other=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const attempt=prepareChatComposer({...emptyChatComposer(),text,mentions});
 const row={id:attempt.id,user_id:user,content:text,reply_to_message_id:null,message_type:'user',image_url:null};
 for(const mention_data of [null,other]){mockQuery.mockResolvedValue({data:{...row,mention_data},error:null});expect(await checkChatComposerAttempt(room,attempt,owner)).toBe(false);}
 mockQuery.mockResolvedValue({data:{...row,mention_data:mentions},error:null});
 expect(await checkChatComposerAttempt(room,attempt,owner)).toBe(true);
});

it('keeps an edit when another device changed only who the same name refers to',async()=>{
 const text='@Alex, hello';
 const mentions=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const other=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const draft={...emptyChatComposer(),text:'Updated message',edit:{id:parent,content:text,mentions}};
 const attempt=prepareChatComposer(draft);
 mockQuery.mockResolvedValue({data:{id:parent,user_id:user,content:text,mention_data:other,message_type:'user',image_url:null},error:null});
 await expect(verifyChatComposerTarget(room,attempt,owner)).rejects.toThrow('changed');
});
