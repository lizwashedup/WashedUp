const mockRpc=jest.fn(),mockUser=jest.fn(),mockSession=jest.fn(),mockInvoke=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:()=>mockUser(),getSession:()=>mockSession()},functions:{invoke:(...a:unknown[])=>mockInvoke(...a)},rpc:(...a:unknown[])=>mockRpc(...a)}}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
import {cancelPageEventMediaReuse,completePageEventMediaReuse,getPageEventMediaSource,parsePageEventMediaSource,pageEventMediaReuseInput,reservePageEventMediaReuse,getPageEventMediaReuseAttempt,type PageEventMediaReuseIntent} from '../creatorPageEventMediaReuse';
import {pageEventMediaPath} from '../creatorPageEventMedia';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fc40000-0000-4000-8000-000000000001',id='0fc40000-0000-4000-8000-000000000002',sourceId='0fc40000-0000-4000-8000-000000000003',sourceEvent='0fc40000-0000-4000-8000-000000000004',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';let current=true;
const scope={userId:user,isCurrent:()=>current};
const source={pageId:page,eventId:sourceEvent,mediaId:sourceId,purpose:'image' as const,byteSize:100,mimeType:'image/jpeg' as const,contentDigest:'a'.repeat(64),objectName:`${sourceEvent}/private-${sourceId}.jpg`};
const intent:PageEventMediaReuseIntent={mediaId:id,purpose:'cover',source};
const rawSource=()=>({media_id:sourceId,page_id:page,event_id:sourceEvent,purpose:'image',byte_size:100,mime_type:'image/jpeg',content_digest:source.contentDigest,object_name:source.objectName});
const row=()=>({id,page_id:page,event_id:event,created_by:user,purpose:'cover',byte_size:100,mime_type:'image/jpeg',content_digest:source.contentDigest,object_name:pageEventMediaPath(event,pageEventMediaReuseInput(intent)),created_at:'2026-09-15T00:00:00Z',ready_at:null,abandoned_at:null,attached:false,object_present:false,source_media_id:sourceId,source_page_id:page,source_event_id:sourceEvent,source_object_name:source.objectName});
beforeEach(()=>{jest.clearAllMocks();current=true;mockUser.mockResolvedValue({data:{user:{id:user}},error:null});mockRpc.mockResolvedValue({data:row(),error:null});});
it('fetches the exact source under current-account ownership and accepts another uploader without exposing identity',async()=>{
 mockRpc.mockResolvedValue({data:{...rawSource(),created_by:'another-person'},error:null});const r=await getPageEventMediaSource(page,sourceEvent,sourceId,scope);
 expect(r).toEqual(source);expect(mockUser).toHaveBeenCalledTimes(2);expect(mockRpc).toHaveBeenCalledWith('get_creator_page_event_media_source',{p_page_id:page,p_event_id:sourceEvent,p_media_id:sourceId});
});
it.each(['media_id','page_id','event_id','purpose','byte_size','mime_type','content_digest','object_name'])('rejects mismatched source %s',field=>{
 expect(()=>parsePageEventMediaSource({...rawSource(),[field]:'incorrect'},page,sourceEvent,sourceId)).toThrow();
});
it('reserves only exact source/destination/purpose without projecting local fields',async()=>{
 const r=await reservePageEventMediaReuse(page,event,{...intent,fileUri:'private',source:{...source,fileUri:'private'}} as any,scope);
 expect(r.source).toEqual(source);expect(mockRpc).toHaveBeenCalledWith('reserve_creator_page_event_media_reuse',{p_page_id:page,p_event_id:event,p_media_id:id,p_purpose:'cover',p_source_page_id:page,p_source_event_id:sourceEvent,p_source_media_id:sourceId});
});
it.each(['source_media_id','source_page_id','source_event_id','source_object_name','content_digest','purpose','created_by','object_name'])('rejects a changed original copy %s',async field=>{
 mockRpc.mockResolvedValue({data:{...row(),[field]:'incorrect'},error:null});await expect(reservePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();
});
it('keeps missing recovery separate from missing reservation receipt',async()=>{
 mockRpc.mockResolvedValue({data:null,error:null});expect(await getPageEventMediaReuseAttempt(page,event,intent,scope)).toBeNull();expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_purpose');await expect(reservePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();
});
it('does not dispatch after an account change',async()=>{
 mockUser.mockResolvedValue({data:{user:{id:'other'}}});await expect(reservePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();
});
it('does not adopt a committed response after the visit ends',async()=>{
 mockRpc.mockImplementation(async()=>{current=false;return{data:row(),error:null};});await expect(reservePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();
});
it('captures nested source before asynchronous authentication',async()=>{
 const original={...intent,source:{...source}};mockUser.mockImplementation(async()=>{original.source.mediaId='changed';return{data:{user:{id:user}}};});
 expect((await reservePageEventMediaReuse(page,event,original,scope)).source.mediaId).toBe(sourceId);expect(mockRpc.mock.calls[0][1].p_source_media_id).toBe(sourceId);
});
it('keeps backend revocation denial and never dispatches an alternate write',async()=>{
 const error={code:'42501'};mockRpc.mockResolvedValue({data:null,error});await expect(reservePageEventMediaReuse(page,event,intent,scope)).rejects.toEqual(error);expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('rejects self-copy, invalid paths and incompatible media before a request',async()=>{
 for(const bad of [{...intent,mediaId:sourceId},{...intent,purpose:'video'},{...intent,source:{...source,objectName:'https://public/image'}}])await expect(reservePageEventMediaReuse(page,event,bad as any,scope)).rejects.toThrow();
 expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps the video byte limit and MIME when duplicating a video',()=>{
 const video={...source,purpose:'video' as const,mimeType:'video/mp4' as const,byteSize:104857600,objectName:source.objectName.replace('.jpg','.mp4')};
 expect(pageEventMediaReuseInput({...intent,purpose:'video',source:video}).byteSize).toBe(104857600);
 expect(()=>pageEventMediaReuseInput({...intent,purpose:'cover',source:video})).toThrow();
});

describe('trusted reuse completion',()=>{
 beforeEach(()=>{mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'captured-token'}},error:null});mockInvoke.mockResolvedValue({data:{...row(),ready_at:'2026-09-15T10:00:00Z',object_present:true},error:null});});
 it('sends only exact target IDs with captured actor token and no direct completion fallback',async()=>{
  const result=await completePageEventMediaReuse(page,event,intent,scope);expect(result.readyAt).toBeTruthy();
  expect(mockInvoke).toHaveBeenCalledWith('verify-event-media-reuse',expect.objectContaining({body:{pageId:page,eventId:event,mediaId:id},headers:{Authorization:'Bearer captured-token'},timeout:55000}));
  expect(mockRpc.mock.calls.every(([name])=>name==='get_creator_page_event_media_reuse_attempt')).toBe(true);
 });
 it('does not invoke a verifier for a missing original reservation',async()=>{mockRpc.mockResolvedValue({data:null,error:null});await expect(completePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();expect(mockInvoke).not.toHaveBeenCalled();});
 it('rejects a changed session before invocation',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:'different'},access_token:'other'}}});await expect(completePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();expect(mockInvoke).not.toHaveBeenCalled();});
 it('captures immutable source and target before account checks',async()=>{const value={...intent,source:{...source}};mockUser.mockImplementation(async()=>{value.mediaId='changed';value.source.mediaId='changed';return{data:{user:{id:user}}};});await completePageEventMediaReuse(page,event,value,scope);expect(mockInvoke.mock.calls[0][1].body.mediaId).toBe(id);});
 it('keeps an unknown verifier result without retry or alternate completion',async()=>{const error=Error('unknown outcome');mockInvoke.mockResolvedValue({data:null,error});await expect(completePageEventMediaReuse(page,event,intent,scope)).rejects.toBe(error);expect(mockInvoke).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledTimes(1);});
 it.each([{ready_at:null},{object_present:false},{created_by:'different'},{id:sourceId}])('refuses an unconfirmed or wrong verifier receipt %p',async patch=>{mockInvoke.mockResolvedValue({data:{...row(),ready_at:'2026-09-15T10:00:00Z',object_present:true,...patch},error:null});await expect(completePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();});
 it('does not adopt a late response after retirement',async()=>{mockInvoke.mockImplementation(async()=>{current=false;return{data:{...row(),ready_at:'2026-09-15T10:00:00Z',object_present:true},error:null};});await expect(completePageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();});
 it('passes cancellation into the existing function client and rejects late completion',async()=>{const controller=new AbortController();mockInvoke.mockImplementation(async()=>{controller.abort();return{data:{...row(),ready_at:'2026-09-15T10:00:00Z',object_present:true},error:null};});await expect(completePageEventMediaReuse(page,event,intent,scope,controller.signal)).rejects.toThrow();expect(mockInvoke.mock.calls[0][1].signal).toBe(controller.signal);});
});

describe('explicit reuse cancellation',()=>{
 beforeEach(()=>{mockRpc.mockReset();mockUser.mockReset();mockUser.mockResolvedValue({data:{user:{id:user}},error:null});mockRpc.mockResolvedValue({data:{...row(),abandoned_at:'2026-09-15T10:00:00Z'},error:null});});
 it('sends only the captured original intent, without fetching a revoked source',async()=>{
  const r=await cancelPageEventMediaReuse(page,event,{...intent,fileUri:'private'} as any,scope);expect(r.abandonedAt).toBeTruthy();
  expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledWith('cancel_creator_page_event_media_reuse',{p_page_id:page,p_event_id:event,p_media_id:id,p_purpose:'cover',p_byte_size:100,p_mime_type:'image/jpeg',p_content_digest:source.contentDigest,p_source_page_id:page,p_source_event_id:sourceEvent,p_source_media_id:sourceId});
 });
 it('preserves media already attached by a valid edit',async()=>{mockRpc.mockResolvedValue({data:{...row(),attached:true,ready_at:'2026-09-15T10:00:00Z',object_present:true},error:null});expect((await cancelPageEventMediaReuse(page,event,intent,scope)).attached).toBe(true);});
 it.each([null,row(),{...row(),abandoned_at:'2026-09-15T10:00:00Z',source_media_id:id},{...row(),abandoned_at:'2026-09-15T10:00:00Z',content_digest:'b'.repeat(64)}])('rejects an absent, nonterminal or mismatched receipt',async data=>{mockRpc.mockResolvedValue({data,error:null});await expect(cancelPageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();});
 it('retains an unknown response without retrying or reserving source media',async()=>{const error=Error('lost response');mockRpc.mockResolvedValue({data:null,error});await expect(cancelPageEventMediaReuse(page,event,intent,scope)).rejects.toBe(error);expect(mockRpc).toHaveBeenCalledTimes(1);});
 it('captures metadata before asynchronous account verification',async()=>{const value={...intent,source:{...source}};mockUser.mockImplementation(async()=>{value.source.contentDigest='b'.repeat(64);return{data:{user:{id:user}}};});expect((await cancelPageEventMediaReuse(page,event,value,scope)).contentDigest).toBe(source.contentDigest);});
 it('rejects account change before dispatch',async()=>{mockUser.mockResolvedValue({data:{user:{id:'other'}}});await expect(cancelPageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
 it('rejects late acknowledgement after visit retirement',async()=>{mockRpc.mockImplementation(async()=>{current=false;return{data:{...row(),abandoned_at:'2026-09-15T10:00:00Z'},error:null};});await expect(cancelPageEventMediaReuse(page,event,intent,scope)).rejects.toThrow();});
});
