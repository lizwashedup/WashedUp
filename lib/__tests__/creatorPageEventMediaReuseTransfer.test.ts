const mockContents=jest.fn(),mockRead=jest.fn(),mockState=jest.fn(),mockSource=jest.fn(),mockGet=jest.fn(),mockReserve=jest.fn(),mockComplete=jest.fn(),mockAccount=jest.fn(),mockLoad=jest.fn(),mockVerify=jest.fn(),mockSession=jest.fn(),mockDownload=jest.fn(),mockUpload=jest.fn(),mockInfo=jest.fn(),mockMkdir=jest.fn(),mockWrite=jest.fn();
let mockAppListener:(state:string)=>void,mockAuthListener:(event?:string,session?:{user:{id:string}}|null)=>void;const mockAppRemove=jest.fn(),mockAuthRemove=jest.fn();
jest.mock('react-native',()=>({AppState:{currentState:'active',addEventListener:(_name:string,fn:any)=>{mockAppListener=fn;return{remove:mockAppRemove};}}}));
jest.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///private/',EncodingType:{Base64:'base64'},readAsStringAsync:(...a:unknown[])=>mockContents(...a),FileSystemSessionType:{FOREGROUND:1},FileSystemUploadType:{BINARY_CONTENT:'binary'},makeDirectoryAsync:(...a:unknown[])=>mockMkdir(...a),writeAsStringAsync:(...a:unknown[])=>mockWrite(...a),getInfoAsync:(...a:unknown[])=>mockInfo(...a),createDownloadResumable:(...a:unknown[])=>mockDownload(...a),createUploadTask:(...a:unknown[])=>mockUpload(...a)}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0fd60000-0000-4000-8000-000000000009'}));
jest.mock('../supabase',()=>({SUPABASE_URL:'http://local-test',SUPABASE_ANON_KEY:'anon',supabase:{auth:{getSession:()=>mockSession(),onAuthStateChange:(fn:any)=>{mockAuthListener=fn;return{data:{subscription:{unsubscribe:mockAuthRemove}}};}}}}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
jest.mock('../creatorPageEventSave',()=>({getPageEventSaveState:(...a:unknown[])=>mockState(...a)}));
jest.mock('../creatorPageEventMedia',()=>({...jest.requireActual('../creatorPageEventMedia'),assertPageEventMediaAccount:(...a:unknown[])=>mockAccount(...a),completePageEventMedia:(...a:unknown[])=>mockComplete(...a)}));
jest.mock('../creatorPageEventMediaReuse',()=>({...jest.requireActual('../creatorPageEventMediaReuse'),completePageEventMediaReuse:(...a:unknown[])=>mockComplete(...a),getPageEventMediaSource:(...a:unknown[])=>mockSource(...a),getPageEventMediaReuseAttempt:(...a:unknown[])=>mockGet(...a),reservePageEventMediaReuse:(...a:unknown[])=>mockReserve(...a)}));
jest.mock('../creatorPageEventMediaReuseAttempt',()=>({readPageEventMediaReuseAttempts:(...a:unknown[])=>mockRead(...a)}));
jest.mock('../eventMediaSource',()=>({loadEventMediaSource:(...a:unknown[])=>mockLoad(...a)}));
jest.mock('../verifyEventMediaFileCopy',()=>({verifyEventMediaFileCopy:(...a:unknown[])=>mockVerify(...a)}));
import {startPageEventMediaReuseTransfer} from '../creatorPageEventMediaReuseTransfer';
import type {PageEventMediaReuseAttempt} from '../creatorPageEventMediaReuseAttempt';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fd60000-0000-4000-8000-000000000001',id='0fd60000-0000-4000-8000-000000000002',sourceId='0fd60000-0000-4000-8000-000000000003',sourceEvent='0fd60000-0000-4000-8000-000000000004',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';let current=true;let calls:string[];
const source={pageId:page,eventId:sourceEvent,mediaId:sourceId,purpose:'image' as const,byteSize:100,mimeType:'image/jpeg' as const,contentDigest:'a'.repeat(64),objectName:`${sourceEvent}/private-${sourceId}.jpg`};
const attempt:PageEventMediaReuseAttempt={version:1,pageId:page,eventId:event,userId:user,mediaId:id,purpose:'cover',source};
const scope={userId:user,isCurrent:()=>current};const row=()=>({...attempt,byteSize:100,mimeType:'image/jpeg',contentDigest:source.contentDigest,objectName:`${event}/private-${id}.jpg`,createdAt:'time',readyAt:null,abandonedAt:null,objectPresent:false,attached:false});
const flush=async()=>{for(let n=0;n<80;n++)await Promise.resolve();};
beforeEach(()=>{jest.clearAllMocks();current=true;calls=[];mockRead.mockResolvedValue([attempt]);mockState.mockResolvedValue({status:'Draft'});mockSource.mockResolvedValue(source);mockGet.mockResolvedValue(row());mockReserve.mockResolvedValue(row());mockComplete.mockImplementation(async()=>{calls.push('confirm');return{...row(),readyAt:'time',objectPresent:true};});mockAccount.mockResolvedValue(undefined);mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'token'}}});mockInfo.mockResolvedValue({exists:true,isDirectory:false,size:100,modificationTime:1});mockMkdir.mockResolvedValue(undefined);mockWrite.mockResolvedValue(undefined);mockVerify.mockImplementation(async()=>{calls.push('verify');});mockLoad.mockResolvedValue({uri:'http://local-test/private',headers:{Authorization:'Bearer token'},useCaching:false});mockDownload.mockImplementation((_url:string,uri:string)=>({cancelAsync:jest.fn().mockResolvedValue(undefined),downloadAsync:async()=>{calls.push(uri.includes('original')?'source':'readback');return{status:200,uri,mimeType:'image/jpeg'};}}));mockUpload.mockImplementation(()=>({cancelAsync:jest.fn().mockResolvedValue(undefined),uploadAsync:async()=>{calls.push('upload');return{status:201};}}));});
it('connects original transfer, bounded read-back verification and confirmation in order',async()=>{
 const result=await startPageEventMediaReuseTransfer(attempt,scope).done;
 expect(calls).toEqual(['source','upload','readback','verify','confirm']);expect(result.receipt.readyAt).toBeTruthy();expect(mockVerify).toHaveBeenCalledWith({originalUri:result.originalUri,copyUri:result.copyUri,byteSize:100,mimeType:'image/jpeg'},scope,expect.anything());
 expect(mockWrite.mock.calls[0][0]).toContain(`${user}/${page}/${event}/${id}/`);expect(mockWrite.mock.calls[0][1]).not.toContain('Bearer');expect(mockWrite.mock.calls[0][1]).not.toContain('token');
 expect(mockUpload.mock.calls[0][2].headers['x-upsert']).toBe('false');expect(mockDownload.mock.calls.every(c=>c[2].cache===false&&c[2].sessionType===1)).toBe(true);expect(mockAppRemove).toHaveBeenCalledTimes(1);expect(mockAuthRemove).toHaveBeenCalledTimes(1);
});
it('rejects an unsaved or altered attempt before file/network work',async()=>{mockRead.mockResolvedValue([]);await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow();expect(mockSource).not.toHaveBeenCalled();expect(mockDownload).not.toHaveBeenCalled();});
it('reserves only when fresh recovery proves the original reservation is absent',async()=>{mockGet.mockResolvedValueOnce(null);await startPageEventMediaReuseTransfer(attempt,scope).done;expect(mockReserve).toHaveBeenCalledTimes(1);});
it('retains uncertain reservation without starting a transfer',async()=>{mockGet.mockResolvedValue(null);mockReserve.mockRejectedValue(Error('lost receipt'));await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('lost receipt');expect(mockDownload).not.toHaveBeenCalled();});
it('checks uploaded-but-unconfirmed bytes without uploading again',async()=>{mockGet.mockResolvedValue({...row(),objectPresent:true});await startPageEventMediaReuseTransfer(attempt,scope).done;expect(mockUpload).not.toHaveBeenCalled();expect(calls).toEqual(['source','readback','verify','confirm']);});
it('rechecks bytes for already confirmed recovery rather than trusting local completion',async()=>{mockGet.mockResolvedValue({...row(),readyAt:'time',objectPresent:true});await startPageEventMediaReuseTransfer(attempt,scope).done;expect(mockUpload).not.toHaveBeenCalled();expect(mockVerify).toHaveBeenCalledTimes(1);});
it.each([{abandonedAt:'time'},{readyAt:'time',objectPresent:false}])('does not resume terminal/missing bytes %p',async patch=>{mockGet.mockResolvedValue({...row(),...patch});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow();expect(mockDownload).not.toHaveBeenCalled();});
it.each(['Completed','Cancelled'])('rejects %s destination before transfer',async status=>{mockState.mockResolvedValue({status});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('closed');expect(mockDownload).not.toHaveBeenCalled();});
it('rejects a changed source identity/fingerprint',async()=>{mockSource.mockResolvedValue({...source,contentDigest:'b'.repeat(64)});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('source media changed');expect(mockDownload).not.toHaveBeenCalled();});
it('does not confirm mismatched read-back bytes',async()=>{mockVerify.mockRejectedValue(Error('differs'));await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('differs');expect(mockComplete).not.toHaveBeenCalled();});
it('rechecks authority after byte comparison and before confirmation',async()=>{mockVerify.mockImplementation(async()=>{mockSource.mockRejectedValue(Error('revoked'));});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('revoked');expect(mockComplete).not.toHaveBeenCalled();});
it('does not upload under a changed session account',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:sourceId},access_token:'other'}}});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow();expect(mockUpload).not.toHaveBeenCalled();});
it.each([{status:206},{status:404},{mimeType:'text/html'},{uri:'file:///wrong'}])('rejects invalid download result %p',async patch=>{mockDownload.mockImplementation((_url:string,uri:string)=>({cancelAsync:jest.fn(),downloadAsync:async()=>({status:200,uri,mimeType:'image/jpeg',...patch})}));await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow();expect(mockUpload).not.toHaveBeenCalled();});
it('rejects changed downloaded size before upload',async()=>{mockInfo.mockResolvedValue({exists:true,isDirectory:false,size:101});await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('size changed');expect(mockUpload).not.toHaveBeenCalled();});
it('keeps an uncertain upload result for fresh recovery, without confirming or retrying',async()=>{mockUpload.mockImplementation(()=>({cancelAsync:jest.fn(),uploadAsync:async()=>{throw Error('lost upload');}}));await expect(startPageEventMediaReuseTransfer(attempt,scope).done).rejects.toThrow('lost upload');expect(mockComplete).not.toHaveBeenCalled();expect(mockUpload).toHaveBeenCalledTimes(1);});
it.each(['cancel','background','account'])('retires pending transport on %s and retains its lock until the native task settles',async mode=>{
 let release!:(result:any)=>void;const cancelled=jest.fn().mockResolvedValue(undefined);mockDownload.mockImplementation(()=>({cancelAsync:cancelled,downloadAsync:()=>new Promise(resolve=>{release=resolve;})}));
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow();await flush();expect(mockDownload).toHaveBeenCalledTimes(1);
 if(mode==='cancel')transfer.cancel();else if(mode==='background')mockAppListener('background');else mockAuthListener();await rejection;expect(cancelled).toHaveBeenCalledTimes(1);
 expect(()=>startPageEventMediaReuseTransfer(attempt,scope)).toThrow('already in progress');release(undefined);await flush();expect(mockUpload).not.toHaveBeenCalled();expect(mockComplete).not.toHaveBeenCalled();
});
it('bounds a stalled transport and preserves its lock through a late response',async()=>{
 jest.useFakeTimers();let release!:(result:any)=>void;const cancelled=jest.fn().mockResolvedValue(undefined);mockDownload.mockImplementation(()=>({cancelAsync:cancelled,downloadAsync:()=>new Promise(resolve=>{release=resolve;})}));
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow('stopped responding');await flush();jest.advanceTimersByTime(60000);await rejection;expect(cancelled).toHaveBeenCalledTimes(1);release(undefined);await flush();jest.useRealTimers();
});
it('rejects overlapping starts synchronously',async()=>{const first=startPageEventMediaReuseTransfer(attempt,scope);expect(()=>startPageEventMediaReuseTransfer(attempt,scope)).toThrow('already in progress');await first.done;});

it.each([false,true])('executes actual byte verifier within transfer before confirmation; corruption=%s',async corrupt=>{
 const actual=jest.requireActual('../verifyEventMediaFileCopy');mockVerify.mockImplementation(actual.verifyEventMediaFileCopy);
 mockContents.mockImplementation(async(uri:string,{position,length}:any)=>{const bytes=Buffer.alloc(100,3);if(corrupt&&uri.includes('readback'))bytes[99]=4;return bytes.subarray(position,position+length).toString('base64');});
 const result=startPageEventMediaReuseTransfer(attempt,scope).done;
 if(corrupt){await expect(result).rejects.toThrow('differs');expect(mockComplete).not.toHaveBeenCalled();}else{await result;expect(mockComplete).toHaveBeenCalledTimes(1);}
 expect(mockContents).toHaveBeenCalledTimes(2);
});
it('repeated zero-progress callbacks do not extend the stalled-read deadline',async()=>{
 jest.useFakeTimers();let release!:(value:any)=>void,reportProgress:any;const cancelled=jest.fn().mockResolvedValue(undefined);
 mockDownload.mockImplementation((_url:any,_uri:any,_options:any,callback:any)=>{reportProgress=callback;return{cancelAsync:cancelled,downloadAsync:()=>new Promise(resolve=>{release=resolve;})};});
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow('stopped responding');await flush();
 jest.advanceTimersByTime(30000);reportProgress({totalBytesWritten:0});jest.advanceTimersByTime(30000);await rejection;expect(cancelled).toHaveBeenCalledTimes(1);release(undefined);await flush();jest.useRealTimers();
});
it.each([-1,101,NaN])('rejects impossible download progress %s without upload or confirmation',async bytes=>{
 let release!:(value:any)=>void,reportProgress:any;const cancelled=jest.fn().mockResolvedValue(undefined);
 mockDownload.mockImplementation((_url:any,_uri:any,_options:any,callback:any)=>{reportProgress=callback;return{cancelAsync:cancelled,downloadAsync:()=>new Promise(resolve=>{release=resolve;})};});
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow();await flush();reportProgress({totalBytesWritten:bytes});await rejection;expect(cancelled).toHaveBeenCalledTimes(1);release(undefined);await flush();expect(mockUpload).not.toHaveBeenCalled();expect(mockComplete).not.toHaveBeenCalled();
});

it('keeps the transfer active for the initial report of its current session',async()=>{
 const transfer=startPageEventMediaReuseTransfer(attempt,scope);
 mockAuthListener('INITIAL_SESSION',{user:{id:user}});
 await transfer.done;expect(mockUpload).toHaveBeenCalledTimes(1);expect(mockComplete).toHaveBeenCalledTimes(1);
});
it.each([null,{user:{id:'different'}}])('retires an initial report that does not confirm the initiating account: %p',async session=>{
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow();
 mockAuthListener('INITIAL_SESSION',session);await rejection;expect(mockUpload).not.toHaveBeenCalled();expect(mockComplete).not.toHaveBeenCalled();
});
it('does not revive a retired visit when the initial account matches',async()=>{
 const transfer=startPageEventMediaReuseTransfer(attempt,scope),rejection=expect(transfer.done).rejects.toThrow();
 current=false;mockAuthListener('INITIAL_SESSION',{user:{id:user}});await rejection;expect(mockUpload).not.toHaveBeenCalled();
});
