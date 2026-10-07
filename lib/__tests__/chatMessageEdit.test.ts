const mockSession=jest.fn(),mockRpc=jest.fn(),mockHeader=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},rpc:(...args:any[])=>{mockRpc(...args);return{setHeader:(...header:any[])=>mockHeader(...header)};}}}));
import {editOwnChatMessage,ChatEditRefusedError} from '../chatMessageEdit';
const room={kind:'event' as const,id:'plan-a'};let live:boolean;const owner={userId:'alice',isCurrent:()=>live};
beforeEach(()=>{jest.clearAllMocks();live=true;mockSession.mockResolvedValue({data:{session:{user:{id:'alice'},access_token:'captured-token'}},error:null});mockHeader.mockResolvedValue({data:{status:'saved',id:'message-a',content:'Revised'},error:null});});
it('binds exact room, original content and account authorization to the edit RPC',async()=>{expect(await editOwnChatMessage(room,'message-a','Original','Revised',owner)).toBe(true);expect(mockRpc).toHaveBeenCalledWith('edit_own_chat_message',{p_message_id:'message-a',p_kind:'event',p_conversation_id:'plan-a',p_expected_content:'Original',p_content:'Revised'});expect(mockHeader).toHaveBeenCalledWith('Authorization','Bearer captured-token');});
it.each(['unavailable','closed','invalid','changed'])('distinguishes an authoritative %s refusal from uncertain transport',async status=>{mockHeader.mockResolvedValue({data:{status},error:null});await expect(editOwnChatMessage(room,'message-a','Original','Revised',owner)).rejects.toBeInstanceOf(ChatEditRefusedError);});
it.each([null,{status:'saved',id:'different',content:'Revised'},{status:'saved',id:'message-a',content:'Other'}])('rejects an absent or mismatched receipt',async data=>{mockHeader.mockResolvedValue({data,error:null});await expect(editOwnChatMessage(room,'message-a','Original','Revised',owner)).rejects.toThrow('confirmed');});
it('does not dispatch under another account',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:'bob'},access_token:'other'}},error:null});await expect(editOwnChatMessage(room,'message-a','Original','Revised',owner)).rejects.toThrow('account');expect(mockRpc).not.toHaveBeenCalled();});
it('rejects a retired continuation after token lookup',async()=>{mockSession.mockImplementation(async()=>{live=false;return{data:{session:{user:{id:'alice'},access_token:'captured-token'}},error:null};});await expect(editOwnChatMessage(room,'message-a','Original','Revised',owner)).rejects.toThrow('visit');expect(mockRpc).not.toHaveBeenCalled();});
it('does not classify a lost acknowledgment as proof of refusal',async()=>{mockHeader.mockRejectedValue(Error('Connection lost'));try{await editOwnChatMessage(room,'message-a','Original','Revised',owner);throw Error('Expected failure');}catch(error){expect(error).not.toBeInstanceOf(ChatEditRefusedError);expect((error as Error).message).toBe('Connection lost');}});
const mentionDoc=(id='11111111-1111-4111-8111-111111111111')=>({version:1 as const,text:'@Alex',references:[{userId:id,label:'Alex',start:0,end:5}]});
it('sends expected and new identities to the atomic edit RPC',async()=>{
 const old=mentionDoc(),next=mentionDoc('22222222-2222-4222-8222-222222222222');
 mockHeader.mockResolvedValue({data:{status:'saved',id:'message-a',content:'@Alex',mention_data:next},error:null});
 expect(await editOwnChatMessage(room,'message-a','@Alex','@Alex',owner,next,old)).toBe(true);
 expect(mockRpc).toHaveBeenCalledWith('edit_own_chat_message_with_mentions',expect.objectContaining({p_expected_mentions:old,p_mentions:next}));
});
it('rejects text-identical confirmation for the wrong person',async()=>{
 const old=mentionDoc(),next=mentionDoc('22222222-2222-4222-8222-222222222222');
 mockHeader.mockResolvedValue({data:{status:'saved',id:'message-a',content:'@Alex',mention_data:old},error:null});
 await expect(editOwnChatMessage(room,'message-a','@Alex','@Alex',owner,next,old)).rejects.toThrow('confirmed');
});
it('clears removed identities through the atomic RPC',async()=>{
 mockHeader.mockResolvedValue({data:{status:'saved',id:'message-a',content:'Revised',mention_data:null},error:null});
 await editOwnChatMessage(room,'message-a','@Alex','Revised',owner,null,mentionDoc());
 expect(mockRpc).toHaveBeenCalledWith('edit_own_chat_message_with_mentions',expect.objectContaining({p_mentions:null}));
});
