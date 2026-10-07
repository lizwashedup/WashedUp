import {planPageEventReuse,materializePageEventReuse} from '../creatorPageEventReusePlan';
import {pageEventMediaPath} from '../creatorPageEventMedia';
const id=(n:number)=>`0fc10000-0000-4000-8000-${String(n).padStart(12,'0')}`,page=id(1),sourceEvent=id(2),targetPage=id(3),targetEvent=id(4),user=id(5);
const source=(n:number,purpose:any):any=>({mediaId:id(n),pageId:page,eventId:sourceEvent,purpose,byteSize:100,mimeType:purpose==='video'?'video/mp4':'image/jpeg',contentDigest:'a'.repeat(64),objectName:sourceEvent+'/private-'+id(n)+(purpose==='video'?'.mp4':'.jpg')});
const assets=[source(10,'cover'),source(11,'image'),source(12,'video'),source(13,'poster')];
const fields:any={title:'A night in LA',description:'The story',image_url:'creator-event-media:'+assets[0].objectName,event_date:'2027-01-01',start_time:'2027-01-01T20:00:00Z',end_time:'2027-01-01T23:00:00Z',venue:'The room',venue_address:'Los Angeles',category:'Social',external_url:'',ticket_price:'',public_name:'Page',pin_to_chat:true,confirmation_message:'See you there',description_blocks:[{type:'text',content:'First story'},{type:'image',path:assets[1].objectName,alt:'Photo'},{type:'text',content:'Between them'},{type:'video',path:assets[2].objectName,poster:assets[3].objectName,alt:'Preview'},{type:'faq'}]};
const plan=()=>planPageEventReuse(page,sourceEvent,fields);
const copies=(p=plan())=>p.media.map((slot,i)=>{const s=assets.find(a=>a.mediaId===slot.sourceMediaId)!;const receipt={...s,pageId:targetPage,eventId:targetEvent,userId:user,mediaId:id(20+i),purpose:slot.purpose,objectName:'',readyAt:'2026-09-15T00:00:00Z',objectPresent:true,attached:false,abandonedAt:null};receipt.objectName=pageEventMediaPath(targetEvent,receipt);return{slotKey:slot.key,source:s,receipt};});
it('retains the complete ordered story, media, poster, FAQ and confirmation while clearing only dates',()=>{const p=plan();expect(p.fields).toEqual({...fields,event_date:'',start_time:null,end_time:null});expect(p.media.map(m=>m.purpose)).toEqual(['cover','image','video','poster']);expect(fields.event_date).toBe('2027-01-01');});
it('maps every confirmed private object into the destination folder without losing text or alternative text',()=>{const p=plan(),c=copies(p),next=materializePageEventReuse(p,targetPage,targetEvent,c);expect(next.image_url).toBe('creator-event-media:'+c[0].receipt.objectName);expect(next.description_blocks).toEqual([{type:'text',content:'First story'},{type:'image',path:c[1].receipt.objectName,alt:'Photo'},{type:'text',content:'Between them'},{type:'video',path:c[2].receipt.objectName,poster:c[3].receipt.objectName,alt:'Preview'},{type:'faq'}]);expect(next.confirmation_message).toBe('See you there');expect(JSON.stringify(next)).not.toContain(sourceEvent);});
it('missing or duplicate receipts cannot produce a partial save payload',()=>{const p=plan(),c=copies(p);expect(()=>materializePageEventReuse(p,targetPage,targetEvent,c.slice(0,3))).toThrow('every');expect(()=>materializePageEventReuse(p,targetPage,targetEvent,[c[0],c[0],c[2],c[3]])).toThrow('every');});
it.each(['not-ready','wrong-digest','wrong-event','wrong-source','abandoned','missing-object'])('%s copy cannot replace the original reference',kind=>{const p=plan(),c=copies(p);if(kind==='not-ready')c[0].receipt.readyAt=null as any;if(kind==='wrong-digest')c[0].receipt.contentDigest='b'.repeat(64);if(kind==='wrong-event')c[0].receipt.eventId=sourceEvent;if(kind==='wrong-source')c[0].source={...c[0].source,pageId:targetPage};if(kind==='abandoned')c[0].receipt.abandonedAt='time' as any;if(kind==='missing-object')c[0].receipt.objectPresent=false;expect(()=>materializePageEventReuse(p,targetPage,targetEvent,c)).toThrow();});
it('same media used twice preserves both positions with one exact-purpose copy',()=>{const input={...fields,description_blocks:[fields.description_blocks[1],fields.description_blocks[1]]},p=planPageEventReuse(page,sourceEvent,input);expect(p.media).toHaveLength(2);const next=materializePageEventReuse(p,targetPage,targetEvent,copies(p));expect(next.description_blocks).toHaveLength(2);expect(next.description_blocks![0]).toEqual(next.description_blocks![1]);});
it('a malformed protected URL or another event’s object fails before any copy plan',()=>{expect(()=>planPageEventReuse(page,sourceEvent,{...fields,image_url:'https://x.invalid/creator-event-media/file'})).toThrow('reference');expect(()=>planPageEventReuse(page,sourceEvent,{...fields,description_blocks:[{type:'image',path:targetEvent+'/private-'+id(11)+'.jpg'}]})).toThrow('reference');});
it('legacy body media stays explicit work, never silently removed or attached from the source folder',()=>{const p=planPageEventReuse(page,sourceEvent,{...fields,image_url:'https://public.invalid/cover.jpg',description_blocks:[{type:'text',content:'Keep me'},{type:'image',path:sourceEvent+'/photo.jpg'}]});expect(p.media).toMatchObject([{kind:'legacy',reference:sourceEvent+'/photo.jpg'}]);expect(p.fields.description_blocks).toHaveLength(2);expect(()=>materializePageEventReuse(p,targetPage,targetEvent,[])).toThrow('every');});
it('existing public cover and text-only templates preserve their working references',()=>{const p=planPageEventReuse(page,sourceEvent,{...fields,image_url:'https://public.invalid/cover.jpg',description_blocks:[{type:'text',content:'Keep me'}]});expect(p.media).toEqual([]);expect(materializePageEventReuse(p,targetPage,targetEvent,[]).image_url).toBe('https://public.invalid/cover.jpg');});
it('unknown blocks and excessive or duplicate FAQ content remain errors rather than being filtered away',()=>{expect(()=>planPageEventReuse(page,sourceEvent,{...fields,description_blocks:[{type:'unknown'}]})).toThrow('review');expect(()=>planPageEventReuse(page,sourceEvent,{...fields,description_blocks:[{type:'faq'},{type:'faq'}]})).toThrow('marker');expect(()=>planPageEventReuse(page,sourceEvent,{...fields,description_blocks:Array.from({length:31},()=>({type:'text',content:'Text'}))})).toThrow('description');});
it('tampered slot plans and same-event destinations cannot materialize',()=>{const p=plan();expect(()=>materializePageEventReuse({...p,media:p.media.slice(1)},targetPage,targetEvent,copies(p))).toThrow('original');expect(()=>materializePageEventReuse(p,page,sourceEvent,copies(p))).toThrow('different');});
it('version-pinned legacy imports preserve all positions and allow the existing original-upload byte deduplication',()=>{
 const a=sourceEvent+'/older-a.jpg',b=sourceEvent+'/older-b.jpg';const p=planPageEventReuse(page,sourceEvent,{...fields,image_url:'https://public.invalid/cover.jpg',description_blocks:[{type:'image',path:a,alt:'A'},{type:'text',content:'Between'},{type:'image',path:b,alt:'B'}]});
 const r:any={...copies()[1].receipt,purpose:'image'};
 const imports=p.media.map((slot,i)=>({slotKey:slot.key,legacy:{source:{kind:'event' as const,pageId:page,eventId:sourceEvent},reference:slot.reference,purpose:'image' as const,objectId:id(80+i),objectVersion:id(90+i),lastModified:'2026-09-15T00:00:00Z',byteSize:r.byteSize,mimeType:r.mimeType,etag:'"'+'a'.repeat(32)+'"',contentDigest:r.contentDigest},receipt:r}));
 expect(materializePageEventReuse(p,targetPage,targetEvent,imports).description_blocks).toEqual([{type:'image',path:r.objectName,alt:'A'},{type:'text',content:'Between'},{type:'image',path:r.objectName,alt:'B'}]);
 expect(()=>materializePageEventReuse(p,targetPage,targetEvent,[imports[0],{...imports[1],legacy:{...imports[1].legacy,reference:a}}])).toThrow('imports');
 expect(()=>materializePageEventReuse(p,targetPage,targetEvent,[imports[0],{...imports[1],legacy:{...imports[1].legacy,contentDigest:'c'.repeat(64)}}])).toThrow('imports');
});


it.each([['music'], ['fitness', 'outdoors'], ['community', 'business & networking'], ['community', 'just for fun']].map(categories => ({categories})))('preserves category snapshot $categories across the complete copy', ({categories}) => {
 const input = {...fields, category: categories[0], categories};
 const p = planPageEventReuse(page, sourceEvent, input);
 expect(p.fields.categories).toEqual(categories);
 expect(p.fields.categories).not.toBe(categories);
 const result = materializePageEventReuse(p, targetPage, targetEvent, copies(p));
 expect(result.category).toBe(categories[0]);
 expect(result.categories).toEqual(categories);
 expect(result.categories).not.toBe(p.fields.categories);
 expect(result.event_date).toBe('');
});
it.each([null, [], ['music', 'music'], ['music', 'art', 'film'], [''], [3], 'music', ['x'.repeat(81)]].map(categories => ({categories})))('rejects malformed category snapshot $categories before a copy plan', ({categories}) => {
 expect(() => planPageEventReuse(page, sourceEvent, {...fields, categories})).toThrow('original saved event');
});
it('revalidates the category snapshot before materializing a saved plan', () => {
 const p = plan();
 (p.fields as any).categories = ['community', 'music', 'film'];
 expect(() => materializePageEventReuse(p, targetPage, targetEvent, [])).toThrow('original saved event');
});
it('keeps legacy complete snapshots without adding a new categories field', () => {
 const p = plan();
 expect(p.fields).not.toHaveProperty('categories');
 expect(materializePageEventReuse(p, targetPage, targetEvent, copies(p))).not.toHaveProperty('categories');
});
