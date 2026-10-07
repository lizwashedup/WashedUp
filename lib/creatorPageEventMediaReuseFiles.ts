/** Exact-attempt file discovery. Unknown or incomplete nonempty runs are retained. */
import * as FileSystem from 'expo-file-system/legacy';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {mediaUUID} from './creatorPageEventMedia';
import {pageEventMediaReuseInput} from './creatorPageEventMediaReuse';
import type {PageEventMediaReuseAttempt} from './creatorPageEventMediaReuseAttempt';
export interface PageEventMediaReuseRun {runId:string;directory:string;originalUri:string;copyUri:string;originalPresent:boolean;copyPresent:boolean;empty:boolean}
function paths(a:PageEventMediaReuseAttempt,s:CreatorPageScope){
  if(!s.isCurrent()||a.userId!==s.userId||a.version!==1||![a.userId,a.pageId,a.eventId,a.mediaId].every(mediaUUID))throw new CreatorPageScopeExpired();
  const input=pageEventMediaReuseInput(a);
  if(!FileSystem.documentDirectory?.startsWith('file://'))throw Error('Private file storage is unavailable.');
  const ext=input.mimeType==='video/mp4'?'mp4':input.mimeType==='image/jpeg'?'jpg':input.mimeType==='image/png'?'png':'webp';
  return {directory:`${FileSystem.documentDirectory}creator-event-media-reuse/${a.userId}/${a.pageId}/${a.eventId}/${a.mediaId}/`,original:`original.${ext}`,copy:`readback.${ext}`};
}
export async function readPageEventMediaReuseRuns(attempt:PageEventMediaReuseAttempt,s:CreatorPageScope):Promise<PageEventMediaReuseRun[]>{
  const a:PageEventMediaReuseAttempt=JSON.parse(JSON.stringify(attempt)),p=paths(a,s),current=()=>{paths(a,s);};
  const base=await FileSystem.getInfoAsync(p.directory);current();if(!base.exists)return [];
  if(!base.isDirectory)throw Error('Saved media files need review.');
  const names=await FileSystem.readDirectoryAsync(p.directory);current();
  if(names.some(name=>!mediaUUID(name)))throw Error('Unrecognized media files need review.');
  const runs:PageEventMediaReuseRun[]=[];
  for(const runId of names){
    const directory=p.directory+runId+'/',folder=await FileSystem.getInfoAsync(directory);current();
    if(!folder.exists||!folder.isDirectory)throw Error('Saved media files need review.');
    const children=await FileSystem.readDirectoryAsync(directory);current();
    if(children.some(name=>!['attempt.json',p.original,p.copy].includes(name)))throw Error('Unrecognized media files need review.');
    if(children.length){
      if(!children.includes('attempt.json'))throw Error('The original media file record is missing. Keep these files for review.');
      const metadata=await FileSystem.getInfoAsync(directory+'attempt.json');current();
      if(!metadata.exists||metadata.isDirectory||metadata.size<1||metadata.size>16384)throw Error('Saved media file record needs review.');
      const raw=await FileSystem.readAsStringAsync(directory+'attempt.json');current();
      const record=JSON.parse(raw);
      if(!record||record.version!==1||record.runId!==runId||record.original!==p.original||record.readback!==p.copy||JSON.stringify(record.attempt)!==JSON.stringify(a))throw Error('Saved media files belong to a different attempt.');
    }
    for(const name of [p.original,p.copy])if(children.includes(name)){
      const file=await FileSystem.getInfoAsync(directory+name);current();
      // Partial/oversized files may be the failed transfer being cleaned up.
      // Only identity/type controls deletion; content validity is not inferred.
      if(!file.exists||file.isDirectory)throw Error('Saved media files need review.');
    }
    runs.push({runId,directory,originalUri:directory+p.original,copyUri:directory+p.copy,originalPresent:children.includes(p.original),copyPresent:children.includes(p.copy),empty:children.length===0});
  }
  return runs;
}
/** Caller holds the shared work lease. A fresh backend terminal check is required
 * before deleting each run and before forgetting the durable intent. */
export async function removePageEventMediaReuseRuns(a:PageEventMediaReuseAttempt,s:CreatorPageScope,confirmTerminal:()=>Promise<void>){
  const original:PageEventMediaReuseAttempt=JSON.parse(JSON.stringify(a)),p=paths(original,s),current=()=>{paths(original,s);};
  const runs=await readPageEventMediaReuseRuns(original,s);current();
  for(const run of runs){
    await confirmTerminal();current();
    // Revalidate the complete directory before touching another file. Failed
    // partial cleanup can retry using the retained manifest and remaining bytes.
    const fresh=await readPageEventMediaReuseRuns(original,s);current();
    if(!fresh.some(v=>v.runId===run.runId))throw Error('The saved media files changed. Check the attempt again.');
    for(const uri of [run.originalUri,run.copyUri]){await FileSystem.deleteAsync(uri,{idempotent:true});current();}
    const remaining=await FileSystem.readDirectoryAsync(run.directory);current();
    if(remaining.some(name=>name!=='attempt.json'))throw Error('Unrecognized media files need review.');
    await FileSystem.deleteAsync(run.directory+'attempt.json',{idempotent:true});current();
    if((await FileSystem.readDirectoryAsync(run.directory)).length)throw Error('The saved media files changed.');current();
    await FileSystem.deleteAsync(run.directory,{idempotent:true});current();
  }
  const base=await FileSystem.getInfoAsync(p.directory);current();
  if(base.exists){
    if(!base.isDirectory||(await FileSystem.readDirectoryAsync(p.directory)).length)throw Error('More saved media files need review.');current();
    await FileSystem.deleteAsync(p.directory,{idempotent:true});current();
  }
}
