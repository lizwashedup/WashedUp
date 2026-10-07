/** Complete content snapshot for event/template reuse; never attach source-folder media. */
import type {OperatorEventFields} from './creatorEvents';
import {validEventCategories} from './eventCategories';
import type {DescriptionBlock} from './eventContent';
import {BLOCKS_MAX,TEXT_BLOCK_MAX,IMAGE_ALT_MAX} from './eventContent';
import {isProtectedEventMedia,eventMediaReference} from './eventMediaSource';
import {mediaUUID,pageEventMediaPath,type PageEventMediaPurpose,type PageEventMediaReceipt} from './creatorPageEventMedia';
import type {PageEventMediaSource} from './creatorPageEventMediaReuse';
import type {LegacyEventMediaSource} from './legacyEventMediaSource';
export interface EventReuseMediaSlot {key:string;purpose:PageEventMediaPurpose;reference:string;sourceEventId:string;sourceMediaId?:string;kind:'private'|'legacy'}
export interface PageEventReusePlan {version:1;sourcePageId:string;sourceEventId:string;fields:OperatorEventFields;media:EventReuseMediaSlot[]}
export interface EventReuseMediaCopy {slotKey:string;source?:PageEventMediaSource;legacy?:LegacyEventMediaSource&{contentDigest:string};receipt:PageEventMediaReceipt}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const privateId=/\/private-([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\.(jpg|png|webp|mp4)$/i;
const legacyPath=/^([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/([a-z\d][a-z\d._-]*)\.(jpg|jpeg|png|webp|mp4)$/i;
function validFields(fields:OperatorEventFields){
  return !!fields&&['title','description','image_url','event_date','venue','venue_address','category','external_url','ticket_price','public_name'].every(k=>typeof (fields as unknown as Record<string,unknown>)[k]==='string')&&!!fields.title.trim()&&!!fields.category&&typeof fields.pin_to_chat==='boolean'
    &&(fields.categories===undefined||validEventCategories(fields.categories));
}
export function planPageEventReuse(sourcePageId:string,sourceEventId:string,input:OperatorEventFields):PageEventReusePlan {
  if(!mediaUUID(sourcePageId)||!mediaUUID(sourceEventId)||!validFields(input))throw Error('Check the original saved event.');
  const fields:OperatorEventFields=JSON.parse(JSON.stringify(input));
  // Existing template/duplicate rule: dates never travel to the next event.
  fields.event_date='';fields.start_time=null;fields.end_time=null;
  const media:EventReuseMediaSlot[]=[];
  const add=(reference:string,purpose:PageEventMediaPurpose)=>{
    if(!reference)return;
    const protectedValue=isProtectedEventMedia(reference);
    // Existing public cover URLs remain usable; do not reclassify their origin.
    if(purpose==='cover'&&!protectedValue)return;
    const key=purpose+':'+reference;if(media.some(v=>v.key===key))return;
    if(protectedValue){
      const parsed=eventMediaReference(sourceEventId,reference,purpose);
      if(parsed.type!=='private')throw Error('The source media reference does not belong to this event.');
      const id=privateId.exec(parsed.objectName)?.[1];if(!id)throw Error('Check the source media identity.');
      media.push({key,purpose,reference,sourceEventId,sourceMediaId:id,kind:'private'});
    }else{
      const match=legacyPath.exec(reference);
      if(!match||match[1]!==sourceEventId||(purpose==='video'?match[3].toLowerCase()!=='mp4':match[3].toLowerCase()==='mp4'))throw Error('Check the original event media folder.');
      media.push({key,purpose,reference,sourceEventId,kind:'legacy'});
    }
  };
  add(fields.image_url,'cover');
  if(fields.description_blocks!=null){
    if(!Array.isArray(fields.description_blocks)||fields.description_blocks.length>BLOCKS_MAX)throw Error('Check the complete event description.');
    let faq=0;
    for(const value of fields.description_blocks){
      if(!object(value))throw Error('Check the complete event description.');
      const block=value as unknown as DescriptionBlock;
      if(block.type==='text'){if(typeof block.content!=='string'||block.content.length>TEXT_BLOCK_MAX)throw Error('Check the event story.');}
      else if(block.type==='faq'){if(++faq>1)throw Error('Check the event questions marker.');}
      else if(block.type==='image'||block.type==='video'){
        if(typeof block.path!=='string'||!block.path||block.alt!==undefined&&(typeof block.alt!=='string'||block.alt.length>IMAGE_ALT_MAX))throw Error('Check the original event media.');
        add(block.path,block.type);
        if(block.type==='video'&&block.poster!==undefined){if(typeof block.poster!=='string'||!block.poster)throw Error('Check the original video poster.');add(block.poster,'poster');}
      }else throw Error('This event description needs review before reuse.');
    }
  }
  return {version:1,sourcePageId,sourceEventId,fields,media};
}
/** All copies must be confirmed before producing a complete save payload. */
export function materializePageEventReuse(plan:PageEventReusePlan,targetPageId:string,targetEventId:string,copies:EventReuseMediaCopy[]):OperatorEventFields {
  if(!mediaUUID(targetPageId)||!mediaUUID(targetEventId)||targetEventId===plan.sourceEventId||plan.version!==1)throw Error('Choose a different saved destination event.');
  const original=planPageEventReuse(plan.sourcePageId,plan.sourceEventId,plan.fields);
  if(JSON.stringify(original)!==JSON.stringify(plan))throw Error('Use the original complete reuse plan.');
  if(copies.length!==plan.media.length||new Set(copies.map(c=>c.slotKey)).size!==copies.length)throw Error('Finish every original media copy before saving.');
  const mapped=new Map<string,string>(),destinations=new Map<string,{kind:string;purpose:string;digest:string}>();
  for(const slot of plan.media){
    const copy=copies.find(v=>v.slotKey===slot.key);if(!copy)throw Error('Finish every original media copy before saving.');
    const {source:s,receipt:r}=copy;
    if(r.pageId!==targetPageId||r.eventId!==targetEventId||r.purpose!==slot.purpose||r.objectName!==pageEventMediaPath(targetEventId,r)
      ||!r.readyAt||!r.objectPresent||r.abandonedAt)throw Error('Check the confirmed original media copies.');
    const previous=destinations.get(r.objectName);
    if(slot.kind==='legacy'){
      const l=copy.legacy;
      if(s||!l||l.source.pageId!==plan.sourcePageId||l.source.eventId!==plan.sourceEventId||l.reference!==slot.reference||l.purpose!==slot.purpose
        ||!mediaUUID(l.objectId)||!mediaUUID(l.objectVersion)||!Number.isFinite(Date.parse(l.lastModified))||l.contentDigest!==r.contentDigest||l.byteSize!==r.byteSize||l.mimeType!==r.mimeType
        ||previous&&(previous.kind!=='legacy'||previous.purpose!==r.purpose||previous.digest!==r.contentDigest))throw Error('Check the confirmed original media imports.');
    }else if(!s||copy.legacy||s.pageId!==plan.sourcePageId||s.eventId!==plan.sourceEventId||s.mediaId!==slot.sourceMediaId||s.objectName!==pageEventMediaPath(s.eventId,s)
      ||(slot.purpose==='cover'?'creator-event-media:'+s.objectName:s.objectName)!==slot.reference
      ||r.mediaId===s.mediaId||r.contentDigest!==s.contentDigest||r.byteSize!==s.byteSize||r.mimeType!==s.mimeType||previous)throw Error('Check the confirmed original media copies.');
    destinations.set(r.objectName,{kind:slot.kind,purpose:r.purpose,digest:r.contentDigest});mapped.set(slot.key,slot.purpose==='cover'?'creator-event-media:'+r.objectName:r.objectName);
  }
  const fields:OperatorEventFields=JSON.parse(JSON.stringify(plan.fields));
  fields.image_url=mapped.get('cover:'+fields.image_url)??fields.image_url;
  fields.description_blocks=fields.description_blocks?.map(b=>{
    if(b.type==='image')return {...b,path:mapped.get('image:'+b.path)!};
    if(b.type==='video')return {...b,path:mapped.get('video:'+b.path)!,...(b.poster?{poster:mapped.get('poster:'+b.poster)!}:{})};
    return b;
  })??fields.description_blocks;
  return fields;
}
