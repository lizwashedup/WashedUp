import {addChatMentionReference} from '../chatMentionIdentity';
const mockMemory=new Map<string,string>(),mockGet=jest.fn(),mockSet=jest.fn(),mockSession=jest.fn(),mockQuery=jest.fn(),mockBlocked=jest.fn(),mockFrom=jest.fn(),mockFilter=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(k:string)=>mockGet(k),setItem:(k:string,v:string)=>mockSet(k,v)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '51000000-0000-4000-8000-000000000001'}));
jest.mock('../blocking',()=>({getBlockedWith:(...args:any[])=>mockBlocked(...args)}));
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:(table:string)=>{mockFrom(table);const q:any={};for(const n of ['select','eq','maybeSingle'])q[n]=(...args:any[])=>{mockFilter(n,...args);return q;};q.setHeader=()=>mockQuery();return q;}}}));
import {emptyTopicComposer,readTopicComposer,saveTopicComposer,prepareTopicComposer,finishTopicComposer,checkTopicComposerAttempt,verifyTopicComposerTarget,type TopicComposerDraft} from '../topicComposerDraft';
const topic='52000000-0000-4000-8000-000000000001',user='53000000-0000-4000-8000-000000000001',parent='54000000-0000-4000-8000-000000000001';let live:boolean;const owner={userId:user,isCurrent:()=>live};
beforeEach(()=>{jest.clearAllMocks();mockMemory.clear();live=true;mockBlocked.mockResolvedValue(new Set());mockGet.mockImplementation(async k=>mockMemory.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockMemory.set(k,v);});mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'test-token'}},error:null});mockQuery.mockResolvedValue({data:null,error:null});});
it('ordinary text and reply context survive a new read under the same account/topic',async()=>{const draft={...emptyTopicComposer(),text:'Bring a blanket',reply:{id:parent,body:'Where shall we meet?',sender_name:'Aster'}};await saveTopicComposer(topic,owner,draft);expect((await readTopicComposer(topic,owner)).draft).toEqual(draft);expect((await readTopicComposer(topic,{...owner,userId:parent})).draft.text).toBe('');});
it('an edit remains an edit of its exact original message on return',async()=>{const draft={...emptyTopicComposer(),text:'Changed wording',edit:{id:parent,body:'Original wording',edited_at:null}};await saveTopicComposer(topic,owner,draft);const restored=(await readTopicComposer(topic,owner)).draft;expect(prepareTopicComposer(restored)).toMatchObject({kind:'edit',id:parent,text:'Changed wording',edit:{body:'Original wording'}});});
it('the pending original UUID and payload survive newer typing and return',async()=>{let draft={...emptyTopicComposer(),text:'First message'};const attempt=prepareTopicComposer(draft);const saved={...draft,text:'Later typing',attempt};await saveTopicComposer(topic,owner,saved);const restored=(await readTopicComposer(topic,owner)).draft;expect(prepareTopicComposer(restored)).toEqual(attempt);expect(finishTopicComposer(restored,attempt)).toEqual({...saved,attempt:null});});
it('confirmation clears only the matching original composer context',()=>{const draft={...emptyTopicComposer(),text:'Hello'};const attempt=prepareTopicComposer(draft);expect(finishTopicComposer({...draft,attempt},attempt)).toEqual(emptyTopicComposer());expect(finishTopicComposer({...draft,edit:{id:parent,body:'Before',edited_at:null},attempt},attempt).text).toBe('Hello');});
it('reads wait for an already accepted local write after navigation',async()=>{let finish!:()=>void;mockSet.mockImplementationOnce((k,v)=>new Promise<void>(resolve=>{finish=()=>{mockMemory.set(k,v);resolve();};}));const pending=saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'Still kept'});await Promise.resolve();await Promise.resolve();live=false;finish();await pending;live=true;expect((await readTopicComposer(topic,owner)).draft.text).toBe('Still kept');});
it('storage failure retains the original for explicit recovery',async()=>{mockSet.mockRejectedValueOnce(Error('Unavailable'));await expect(saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'Keep this'})).rejects.toThrow();expect(await readTopicComposer(topic,owner)).toMatchObject({draft:{text:'Keep this'},unsaved:true});await saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'Keep this'});expect((await readTopicComposer(topic,owner)).unsaved).toBe(false);});
it('wrong-account sessions never inspect or retry the original message',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:parent},access_token:'other'}},error:null});await expect(checkTopicComposerAttempt(topic,prepareTopicComposer({...emptyTopicComposer(),text:'Hello'}),owner)).rejects.toThrow('account');expect(mockQuery).not.toHaveBeenCalled();});
it('changed or unavailable edit targets are not overwritten',async()=>{const a=prepareTopicComposer({...emptyTopicComposer(),text:'New edit',edit:{id:parent,body:'Before',edited_at:null}});mockQuery.mockResolvedValue({data:{id:parent,sender_id:user,body:'Changed elsewhere',edited_at:null},error:null});await expect(verifyTopicComposerTarget(topic,a,owner)).rejects.toThrow('changed');mockQuery.mockResolvedValue({data:null,error:null});await expect(verifyTopicComposerTarget(topic,a,owner)).rejects.toThrow('available');});
it('receipt checks require the original author and reply target',async()=>{const a=prepareTopicComposer({...emptyTopicComposer(),text:'Hello',reply:{id:parent,body:'Before',sender_name:'Aster'}});mockQuery.mockResolvedValue({data:{sender_id:user,body:'Hello',reply_to_message_id:parent},error:null});expect(await checkTopicComposerAttempt(topic,a,owner)).toBe(true);mockQuery.mockResolvedValue({data:{sender_id:user,body:'Hello',reply_to_message_id:null},error:null});await expect(checkTopicComposerAttempt(topic,a,owner)).rejects.toThrow('reply');});


afterEach(()=>jest.useRealTimers());
function pending<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
it.each(['session','message','blocking'])('ends a stalled %s read and keeps the exact edit for retry',async(stage)=>{
 jest.useFakeTimers();
 const draft={...emptyTopicComposer(),text:'My corrected message',edit:{id:parent,body:'Before',edited_at:null}};
 await saveTopicComposer(topic,owner,draft);
 const wait=pending<any>();
 mockQuery.mockResolvedValue({data:{id:parent,sender_id:user,body:'Before',edited_at:null},error:null});
 if(stage==='session')mockSession.mockReturnValueOnce(wait.promise);
 if(stage==='message')mockQuery.mockReturnValueOnce(wait.promise);
 if(stage==='blocking')mockBlocked.mockReturnValueOnce(wait.promise);
 const check=verifyTopicComposerTarget(topic,prepareTopicComposer(draft),owner);
 const failure=expect(check).rejects.toThrow('took too long');
 await jest.advanceTimersByTimeAsync(12_000);await failure;
 expect((await readTopicComposer(topic,owner)).draft).toEqual(draft);
 expect(mockSession).toHaveBeenCalledTimes(1);
 const queries=mockQuery.mock.calls.length, blocks=mockBlocked.mock.calls.length;
 wait.resolve(stage==='session'?{data:{session:{user:{id:user},access_token:'test-token'}},error:null}:stage==='message'?{data:{id:parent,sender_id:user,body:'Before',edited_at:null},error:null}:new Set());
 await jest.advanceTimersByTimeAsync(0);
 expect(mockQuery).toHaveBeenCalledTimes(queries);expect(mockBlocked).toHaveBeenCalledTimes(blocks);
 // Only an explicit new check starts another read.
 await expect(verifyTopicComposerTarget(topic,prepareTopicComposer(draft),owner)).resolves.toBeUndefined();
});
it('keeps an uncertain original attempt when its receipt check times out',async()=>{
 jest.useFakeTimers();
 const original={...emptyTopicComposer(),text:'Meet by the water'};
 const attempt=prepareTopicComposer(original), draft={...original,attempt};
 await saveTopicComposer(topic,owner,draft);mockQuery.mockReturnValueOnce(new Promise(()=>{}));
 const failure=expect(checkTopicComposerAttempt(topic,attempt,owner)).rejects.toThrow('took too long');
 await jest.advanceTimersByTimeAsync(12_000);await failure;
 expect((await readTopicComposer(topic,owner)).draft).toEqual(draft);
 expect(mockQuery).toHaveBeenCalledTimes(1);
});
it('rejects a late original-message result after the account or visit changes',async()=>{
 const wait=pending<any>();mockQuery.mockReturnValueOnce(wait.promise);
 const check=checkTopicComposerAttempt(topic,prepareTopicComposer({...emptyTopicComposer(),text:'Hello'}),owner);
 const failure=expect(check).rejects.toThrow('visit changed');
 await Promise.resolve();live=false;
 wait.resolve({data:{sender_id:user,body:'Hello'},error:null});await failure;
 expect(mockBlocked).not.toHaveBeenCalled();
});

const firstAlex='cccccccc-cccc-4ccc-8ccc-cccccccccccc',secondAlex='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
it('keeps exact picked identities across storage and trims only the surrounding whitespace',async()=>{
 const text='  🌅 @Alex, hello  ';
 const mentions=addChatMentionReference(text,null,secondAlex,'Alex',5);
 const draft={...emptyTopicComposer(),text,mentions};
 await saveTopicComposer(topic,owner,draft);
 const restored=(await readTopicComposer(topic,owner)).draft;
 expect(restored.mentions).toEqual(mentions);
 const attempt=prepareTopicComposer(restored);
 expect(attempt.mentions).toEqual({version:1,text:'🌅 @Alex, hello',references:[{userId:secondAlex,label:'Alex',start:2,end:7}]});
 expect(attempt.mentions).not.toBe(restored.mentions);
 expect(finishTopicComposer({...restored,attempt},attempt)).toEqual(emptyTopicComposer());
});
it('does not erase a text-identical draft after the chosen person changes',async()=>{
 const text='@Alex, hello';
 const original=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const newer=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text,mentions:original});
 const draft={...emptyTopicComposer(),text,mentions:newer,attempt};
 await saveTopicComposer(topic,owner,draft);
 const restored=(await readTopicComposer(topic,owner)).draft;
 expect(prepareTopicComposer(restored).mentions).toEqual(original);
 expect(finishTopicComposer(restored,attempt)).toEqual({...draft,attempt:null});
});
it('rejects stale identity metadata in a saved composer or uncertain attempt',async()=>{
 const mentions=addChatMentionReference('@Alex',null,firstAlex,'Alex',0);
 await expect(saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'Changed',mentions})).rejects.toThrow('kept');
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:'@Alex',mentions});
 await expect(saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'@Alex',mentions,attempt:{...attempt,text:'Changed'}})).rejects.toThrow('kept');
});
it('requires the stored identity as well as the text to confirm an uncertain send',async()=>{
 const text='@Alex, hello';
 const mentions=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const other=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text,mentions});
 const row={id:attempt.id,sender_id:user,body:text,reply_to_message_id:null};
 for(const mention_data of [null,other]){mockQuery.mockResolvedValue({data:{...row,mention_data},error:null});expect(await checkTopicComposerAttempt(topic,attempt,owner)).toBe(false);}
 mockQuery.mockResolvedValue({data:{...row,mention_data:mentions},error:null});
 expect(await checkTopicComposerAttempt(topic,attempt,owner)).toBe(true);
});

it('keeps an edit when another device changed only who the same name refers to',async()=>{
 const text='@Alex, hello';
 const mentions=addChatMentionReference(text,null,firstAlex,'Alex',0);
 const other=addChatMentionReference(text,null,secondAlex,'Alex',0);
 const draft={...emptyTopicComposer(),text:'Updated message',edit:{id:parent,body:text,mentions,edited_at:null}};
 const attempt=prepareTopicComposer(draft);
 mockQuery.mockResolvedValue({data:{id:parent,sender_id:user,body:text,mention_data:other,edited_at:null},error:null});
 await expect(verifyTopicComposerTarget(topic,attempt,owner)).rejects.toThrow('changed');
});

const mainRoom = { kind: 'main' as const, id: topic };
it('separates main and topic drafts even when their UUIDs match, including uncertain mention identity', async () => {
 const mentions=addChatMentionReference('Hi @Alex',null,parent,'Alex',3);
 const mainDraft={...emptyTopicComposer(),text:'Hi @Alex',mentions};
 const attempt=prepareTopicComposer(mainDraft);
 await saveTopicComposer(mainRoom,owner,{...mainDraft,attempt});
 await saveTopicComposer(topic,owner,{...emptyTopicComposer(),text:'Different topic'});
 expect((await readTopicComposer(mainRoom,owner)).draft).toEqual({...mainDraft,attempt});
 expect((await readTopicComposer(topic,owner)).draft.text).toBe('Different topic');
 expect((await readTopicComposer(mainRoom,{...owner,userId:parent})).draft.text).toBe('');
});
it('reads main attempt receipts only from its community and ordinary message kind', async () => {
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:'Hello',mentions:null});
 mockQuery.mockResolvedValue({data:{id:attempt.id,kind:'message',sender_id:user,body:'Hello',mention_data:null},error:null});
 await expect(checkTopicComposerAttempt(mainRoom,attempt,owner)).resolves.toBe(true);
 expect(mockFrom).toHaveBeenCalledWith('community_broadcasts');
 expect(mockFilter).toHaveBeenCalledWith('eq','community_id',topic);
 expect(mockFilter).toHaveBeenCalledWith('eq','kind','message');
 expect(mockFilter).toHaveBeenCalledWith('select','id,community_id,sender_id,body,kind,edited_at,mention_data');
 mockQuery.mockResolvedValue({data:{id:attempt.id,kind:'intro',sender_id:user,body:'Hello'},error:null});
 await expect(checkTopicComposerAttempt(mainRoom,attempt,owner)).rejects.toThrow('unavailable');
});
it('cannot mistake another selected member with the same label for the saved main attempt', async () => {
 const body='Hi @Alex';
 const mentions=addChatMentionReference(body,null,parent,'Alex',3);
 const other=addChatMentionReference(body,null,topic,'Alex',3);
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:body,mentions});
 mockQuery.mockResolvedValue({data:{id:attempt.id,kind:'message',sender_id:user,body,mention_data:other},error:null});
 await expect(checkTopicComposerAttempt(mainRoom,attempt,owner)).resolves.toBe(false);
});
it('rejects a mismatched stored room kind rather than borrowing a topic draft', async () => {
 mockGet.mockResolvedValueOnce(JSON.stringify({version:1,topicId:topic,userId:user,draft:emptyTopicComposer()}));
 await expect(readTopicComposer(mainRoom,owner)).rejects.toThrow('could not be read');
});

const replyRoom={kind:'reply' as const,id:parent};
it('keeps reply drafts apart from main and topic drafts and preserves uncertain selected identity',async()=>{
 const body='Hello @Alex'; const mentions=addChatMentionReference(body,null,topic,'Alex',6);
 const draft={...emptyTopicComposer(),text:body,mentions};const attempt=prepareTopicComposer(draft);
 await saveTopicComposer(replyRoom,owner,{...draft,text:'Later thought',mentions:null,attempt});
 expect((await readTopicComposer(replyRoom,owner)).draft.attempt).toEqual(attempt);
 expect((await readTopicComposer({kind:'main',id:parent},owner)).draft.text).toBe('');
 expect((await readTopicComposer(parent,owner)).draft.text).toBe('');
 expect((await readTopicComposer(replyRoom,{...owner,userId:topic})).draft.text).toBe('');
});
it('checks a reply receipt only in its original parent and does not select nonexistent edit columns',async()=>{
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:'Hello',mentions:null});
 mockQuery.mockResolvedValue({data:{id:attempt.id,sender_id:user,body:'Hello',mention_data:null},error:null});
 await expect(checkTopicComposerAttempt(replyRoom,attempt,owner)).resolves.toBe(true);
 expect(mockFrom).toHaveBeenCalledWith('community_broadcast_replies');
 expect(mockFilter).toHaveBeenCalledWith('eq','broadcast_id',parent);
 expect(mockFilter).toHaveBeenCalledWith('select','id,broadcast_id,sender_id,body,mention_data');
});
it('requires the visible original parent before recording a new reply attempt',async()=>{
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:'Hello'});
 await expect(verifyTopicComposerTarget(replyRoom,attempt,owner)).rejects.toThrow('no longer available');
 mockQuery.mockResolvedValue({data:{id:parent,sender_id:topic,body:'Original',kind:'intro'},error:null});
 await expect(verifyTopicComposerTarget(replyRoom,attempt,owner)).resolves.toBeUndefined();
 expect(mockFrom).toHaveBeenCalledWith('community_broadcasts');expect(mockFilter).toHaveBeenCalledWith('eq','id',parent);
 expect(mockFilter).not.toHaveBeenCalledWith('eq','community_id',parent);
 mockBlocked.mockResolvedValue(new Set([topic]));
 await expect(verifyTopicComposerTarget(replyRoom,attempt,owner)).rejects.toThrow('unavailable');
});
it('does not accept an edit or nested target in the existing broadcast reply transport',async()=>{
 const attempt=prepareTopicComposer({...emptyTopicComposer(),text:'Hello',reply:{id:topic,body:'Before',sender_name:'Alex'}});
 await expect(verifyTopicComposerTarget(replyRoom,attempt,owner)).rejects.toThrow('cannot be sent');expect(mockQuery).not.toHaveBeenCalled();
});

it('restores a legacy uncertain edit and confirms a late committed result by reading before any original retry', async () => {
  const original = { id: parent, body: 'Original wording', edited_at: null };
  const pending = prepareTopicComposer({ ...emptyTopicComposer(), text: 'Saved legacy revision', edit: original });
  await saveTopicComposer(topic, owner, { ...emptyTopicComposer(), text: 'Newer typing', edit: original, attempt: pending });
  const restored = (await readTopicComposer(topic, owner)).draft;
  expect(prepareTopicComposer(restored)).toEqual(pending);
  expect(pending.mentions).toBeUndefined();
  mockQuery.mockResolvedValueOnce({ data: { id: parent, topic_id: topic, sender_id: user, body: pending.text, edited_at: '2026-09-27T12:00:00Z' }, error: null });
  expect(await checkTopicComposerAttempt(topic, pending, owner)).toBe(true);
  expect(finishTopicComposer(restored, pending)).toEqual({ ...restored, attempt: null });
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(mockFilter.mock.calls.map(call => call[0])).toEqual(['select', 'eq', 'eq', 'maybeSingle']);
  mockQuery.mockResolvedValueOnce({ data: { id: parent, topic_id: topic, sender_id: user, body: 'Someone changed it again', edited_at: '2026-09-27T12:01:00Z' }, error: null });
  await expect(verifyTopicComposerTarget(topic, pending, owner)).rejects.toThrow('original message changed');
});
