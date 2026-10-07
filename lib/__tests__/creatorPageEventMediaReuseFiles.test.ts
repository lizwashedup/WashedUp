const mockInfo=jest.fn(),mockList=jest.fn(),mockRead=jest.fn(),mockDelete=jest.fn();
jest.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///private/',getInfoAsync:(...a:unknown[])=>mockInfo(...a),readDirectoryAsync:(...a:unknown[])=>mockList(...a),readAsStringAsync:(...a:unknown[])=>mockRead(...a),deleteAsync:(...a:unknown[])=>mockDelete(...a)}));
jest.mock('../supabase',()=>({supabase:{}}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
import {readPageEventMediaReuseRuns,removePageEventMediaReuseRuns} from '../creatorPageEventMediaReuseFiles';
import {claimPageEventMediaReuseWork} from '../creatorPageEventMediaReuseWork';
import type {PageEventMediaReuseAttempt} from '../creatorPageEventMediaReuseAttempt';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fd70000-0000-4000-8000-000000000001',id='0fd70000-0000-4000-8000-000000000002',sourceId='0fd70000-0000-4000-8000-000000000003',sourceEvent='0fd70000-0000-4000-8000-000000000004',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb',runId='0fd70000-0000-4000-8000-000000000009';
const a:PageEventMediaReuseAttempt={version:1,pageId:page,eventId:event,userId:user,mediaId:id,purpose:'cover',source:{pageId:page,eventId:sourceEvent,mediaId:sourceId,purpose:'image',byteSize:100,mimeType:'image/jpeg',contentDigest:'a'.repeat(64),objectName:`${sourceEvent}/private-${sourceId}.jpg`}};
const base=`file:///private/creator-event-media-reuse/${user}/${page}/${event}/${id}/`,folder=base+runId+'/';let current=true,files:Map<string,string|null>;
const scope={userId:user,isCurrent:()=>current};const manifest=()=>JSON.stringify({version:1,attempt:a,runId,original:'original.jpg',readback:'readback.jpg'});const confirm=jest.fn();
function list(uri:string){if(files.get(uri)!==null)throw Error('not directory');return [...files.keys()].filter(p=>p.startsWith(uri)&&p!==uri).map(p=>p.slice(uri.length)).filter(p=>!p.replace(/\/$/,'').includes('/')).map(p=>p.replace(/\/$/,''));}
beforeEach(()=>{jest.clearAllMocks();current=true;files=new Map([[base,null],[folder,null],[folder+'attempt.json',manifest()],[folder+'original.jpg','original'],[folder+'readback.jpg','partial']]);mockInfo.mockImplementation(async(uri:string)=>files.has(uri)?{exists:true,isDirectory:files.get(uri)===null,size:files.get(uri)?.length??0}:{exists:false});mockList.mockImplementation(async uri=>list(uri));mockRead.mockImplementation(async uri=>files.get(uri));mockDelete.mockImplementation(async uri=>{for(const p of [...files.keys()])if(p===uri||(uri.endsWith('/')&&p.startsWith(uri)))files.delete(p);});confirm.mockResolvedValue(undefined);});
it('discovers only exact account/page/event/attempt runs and original paths',async()=>{
 expect(await readPageEventMediaReuseRuns(a,scope)).toEqual([{runId,directory:folder,originalUri:folder+'original.jpg',copyUri:folder+'readback.jpg',originalPresent:true,copyPresent:true,empty:false}]);expect(mockDelete).not.toHaveBeenCalled();
});
it('removes only validated files after fresh terminal confirmation',async()=>{
 const other='file:///private/creator-event-media-reuse/another-account/preserved.jpg';files.set(other,'private');await removePageEventMediaReuseRuns(a,scope,confirm);expect(confirm).toHaveBeenCalledTimes(1);expect([...files.keys()]).toEqual([other]);
 expect(mockDelete.mock.calls.every(c=>c[0].startsWith(base)&&c[1].idempotent)).toBe(true);
});
it.each(['../other','unknown.txt'])('refuses unknown attempt-root entry %s before deleting any file',async name=>{mockList.mockResolvedValueOnce([runId,name]);await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('Unrecognized');expect(mockDelete).not.toHaveBeenCalled();});
it('does not remove unknown files within a recognized run',async()=>{files.set(folder+'unrelated.jpg','keep');await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('Unrecognized');expect(mockDelete).not.toHaveBeenCalled();});
it('retains nonempty runs without a manifest',async()=>{files.delete(folder+'attempt.json');await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('record is missing');expect(mockDelete).not.toHaveBeenCalled();});
it('retains corrupt or changed-attempt manifests',async()=>{
 for(const value of ['broken',JSON.stringify({...JSON.parse(manifest()),attempt:{...a,purpose:'poster'}})]){files.set(folder+'attempt.json',value);await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow();}expect(mockDelete).not.toHaveBeenCalled();
});
it('does not read an oversized manifest',async()=>{files.set(folder+'attempt.json','x'.repeat(16385));await expect(readPageEventMediaReuseRuns(a,scope)).rejects.toThrow('record needs review');expect(mockRead).not.toHaveBeenCalled();});
it('refuses media paths that are directories',async()=>{files.set(folder+'original.jpg',null);await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow();expect(mockDelete).not.toHaveBeenCalled();});
it('rejects other account before reading any path',async()=>{await expect(readPageEventMediaReuseRuns(a,{...scope,userId:sourceId})).rejects.toThrow();expect(mockInfo).not.toHaveBeenCalled();});
it('rejects expired scope during discovery without deletion',async()=>{mockRead.mockImplementation(async()=>{current=false;return manifest();});await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow();expect(mockDelete).not.toHaveBeenCalled();});
it('honors backend denial before any deletion',async()=>{confirm.mockRejectedValue(Error('revoked'));await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('revoked');expect(mockDelete).not.toHaveBeenCalled();});
it('retains manifest through partial deletion failure and succeeds on explicit retry',async()=>{
 mockDelete.mockImplementationOnce(async uri=>{files.delete(uri);}).mockRejectedValueOnce(Error('disk'));await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('disk');expect(files.has(folder+'attempt.json')).toBe(true);expect(files.has(folder+'readback.jpg')).toBe(true);
 await removePageEventMediaReuseRuns(a,scope,confirm);expect(files.size).toBe(0);
});
it('cleans empty pre-manifest or post-manifest run directories safely',async()=>{files=new Map([[base,null],[folder,null]]);expect((await readPageEventMediaReuseRuns(a,scope))[0].empty).toBe(true);await removePageEventMediaReuseRuns(a,scope,confirm);expect(files.size).toBe(0);});
it('does not assume missing files require writes',async()=>{files.clear();expect(await readPageEventMediaReuseRuns(a,scope)).toEqual([]);await removePageEventMediaReuseRuns(a,scope,confirm);expect(mockDelete).not.toHaveBeenCalled();});
it('revalidates the directory after terminal confirmation',async()=>{confirm.mockImplementation(async()=>{files.set(folder+'new-unknown','keep');});await expect(removePageEventMediaReuseRuns(a,scope,confirm)).rejects.toThrow('Unrecognized');expect(mockDelete).not.toHaveBeenCalled();});
it('leases are exact-attempt, exclusive and idempotently released',()=>{
 const first=claimPageEventMediaReuseWork(user,page,event,id);expect(()=>claimPageEventMediaReuseWork(user,page,event,id)).toThrow('already in progress');const other=claimPageEventMediaReuseWork(user,page,event,sourceId);other();first();const replacement=claimPageEventMediaReuseWork(user,page,event,id);first();expect(()=>claimPageEventMediaReuseWork(user,page,event,id)).toThrow();replacement();
});
