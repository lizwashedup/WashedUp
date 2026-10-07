/** Version-pinned access to existing public event-content objects. */
import {supabase,SUPABASE_URL} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {getPageEventTemplate} from './creatorPageEventTemplate';
import {mediaUUID,type PageEventMediaMime} from './creatorPageEventMedia';
import type {PageEventReuseSource} from './creatorPageEventReuse';
export type LegacyEventMediaPurpose='image'|'video'|'poster';
export interface LegacyEventMediaSource {
  source:PageEventReuseSource;reference:string;purpose:LegacyEventMediaPurpose;objectId:string;objectVersion:string;
  lastModified:string;byteSize:number;mimeType:PageEventMediaMime;etag:string;
}
const pattern=/^([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/([a-z\d][a-z\d._-]*)\.(jpg|jpeg|png|webp|mp4)$/i;
export function legacyEventMediaPath(source:PageEventReuseSource,reference:string,purpose:LegacyEventMediaPurpose){
  const match=typeof reference==='string'?pattern.exec(reference):null;
  if(!source||!mediaUUID(source.pageId)||!mediaUUID(source.eventId)||!['event','template'].includes(source.kind)||source.kind==='template'&&!mediaUUID(source.templateId)
    ||!['image','video','poster'].includes(purpose)||!match||match[1]!==source.eventId||/creator-event-media|\/private-/i.test(reference)
    ||(purpose==='video'?match[3].toLowerCase()!=='mp4':match[3].toLowerCase()==='mp4'))throw Error('Check the original event media reference.');
  return reference;
}
function current(scope:CreatorPageScope){if(!scope.isCurrent()||!mediaUUID(scope.userId))throw new CreatorPageScopeExpired();}
async function access(source:PageEventReuseSource,reference:string,purpose:LegacyEventMediaPurpose,scope:CreatorPageScope){
  current(scope);let fields;
  if(source.kind==='template'){
    const saved=await getPageEventTemplate(source.pageId,source.eventId,source.templateId,scope);if(!saved)throw Error('The source template is unavailable.');fields=saved.fields;
  }else fields=(await getPageEventSaveState(source.pageId,source.eventId,scope)).fields;
  current(scope);
  const present=fields.description_blocks?.some(b=>purpose==='poster'?b.type==='video'&&b.poster===reference:b.type===purpose&&'path' in b&&b.path===reference);
  if(!present)throw Error('This media is not in the selected saved source.');
}
export function validLegacyEventMediaSource(value:LegacyEventMediaSource){
  try{legacyEventMediaPath(value.source,value.reference,value.purpose);}catch{return false;}
  return mediaUUID(value.objectId)&&mediaUUID(value.objectVersion)&&typeof value.lastModified==='string'&&Number.isFinite(Date.parse(value.lastModified))
    &&Number.isSafeInteger(value.byteSize)&&value.byteSize>0&&value.byteSize<=(value.purpose==='video'?104857600:10485760)
    &&(value.purpose==='video'?value.mimeType==='video/mp4':['image/jpeg','image/png','image/webp'].includes(value.mimeType))
    &&typeof value.etag==='string'&&/^"[a-f\d]{32}(?:-\d+)?"$/i.test(value.etag);
}
export async function getLegacyEventMediaSource(selected:PageEventReuseSource,reference:string,purpose:LegacyEventMediaPurpose,scope:CreatorPageScope):Promise<LegacyEventMediaSource>{
  const source={...selected};legacyEventMediaPath(source,reference,purpose);await access(source,reference,purpose,scope);
  const {data,error}=await supabase.storage.from('event-content').info(reference);current(scope);if(error)throw error;
  const result:LegacyEventMediaSource={source,reference,purpose,objectId:data.id,objectVersion:data.version,lastModified:data.lastModified??'',byteSize:data.size??0,mimeType:data.contentType as PageEventMediaMime,etag:data.etag??''};
  if(data.bucketId!=='event-content'||data.name!==reference||!validLegacyEventMediaSource(result))throw Error('The original media version could not be confirmed.');
  await access(source,reference,purpose,scope);return result;
}
export async function assertLegacyEventMediaSource(original:LegacyEventMediaSource,scope:CreatorPageScope){
  if(!validLegacyEventMediaSource(original))throw Error('Check the original saved media version.');
  const current=await getLegacyEventMediaSource(original.source,original.reference,original.purpose,scope);
  if(['objectId','objectVersion','lastModified','byteSize','mimeType','etag'].some(k=>current[k as keyof LegacyEventMediaSource]!==original[k as keyof LegacyEventMediaSource]))throw Error('The original media changed. Keep this import attempt for review.');
}
export function legacyEventMediaDownloadUrl(source:LegacyEventMediaSource){
  if(!validLegacyEventMediaSource(source))throw Error('Check the original saved media version.');
  // Original bucket is public. Exact known origin/path, no arbitrary URL, signed
  // credentials, transformations or shared cached response for this import.
  return `${SUPABASE_URL}/storage/v1/object/public/event-content/${source.reference}?version=${source.objectVersion}`;
}
