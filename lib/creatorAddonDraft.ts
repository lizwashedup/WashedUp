import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CreatorPageScope} from './creatorPageReview';
import type {AddonDraft,AddonVariation} from './ticketPromosAddons';
import type {CreatorAddon} from './creatorAddonEditor';
import type {CreatorAddonPhoto} from './creatorAddonPhoto';

export interface CreatorAddonForm {
 name:string;description:string;priceText:string;imageUrl:string;capText:string;perOrderMaxText:string;options:AddonVariation[];
}
export interface CreatorAddonRecord {
 recordId:string;form:CreatorAddonForm;baseline:CreatorAddon|null;pending:AddonDraft|null;confirmed:boolean;dispatched?:boolean;photo?:CreatorAddonPhoto|null;
}
const writes=new Map<string,Promise<unknown>>();
const draftQueues=new Map<string,Promise<unknown>>();
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function key(event:string,route:string,scope:CreatorPageScope){
 if(!scope.isCurrent()||![event,scope.userId].every(uuid)||(route!=='new'&&!uuid(route)))throw Error('This extra visit is unavailable.');
 return `creator-extra-draft:v1:${scope.userId}:${event}:${route}`;
}
function valid(v:CreatorAddonRecord,event:string,route:string){
 const f=v?.form;
 if(!v||!uuid(v.recordId)||typeof v.confirmed!=='boolean'||(v.dispatched!==undefined&&typeof v.dispatched!=='boolean')||!f||['name','description','priceText','imageUrl','capText','perOrderMaxText'].some(k=>typeof f[k as keyof CreatorAddonForm]!=='string')
 ||!Array.isArray(f.options)||f.options.length>20||f.options.some(o=>!o||typeof o.id!=='string'||!o.id||typeof o.label!=='string'||o.label.length>120)
 ||(route==='new'?v.baseline!==null:v.recordId!==route||v.baseline?.id!==route||v.baseline?.event_id!==event)
 ||(v.pending!==null&&(!v.pending||typeof v.pending.name!=='string'||!Number.isSafeInteger(v.pending.price_cents)||v.pending.price_cents<0||!['draft','on_sale'].includes(v.pending.status)))
 ||(v.confirmed&&!v.pending))throw Error('Your extra draft could not be read.');
 if(v.photo!==undefined&&v.photo!==null&&(!uuid(v.photo.id)||typeof v.photo.uri!=='string'||!v.photo.uri.startsWith('file://')||v.pending!==null))throw Error('The original extra photo needs to be checked.');
}
async function ordered<T>(k:string,work:()=>Promise<T>){
 const next=(writes.get(k)??Promise.resolve()).catch(()=>undefined).then(work);writes.set(k,next);
 try{return await next;}finally{if(writes.get(k)===next)writes.delete(k);}
}
export async function readCreatorAddonDraft(event:string,route:string,scope:CreatorPageScope){
 const k=key(event,route,scope);await draftQueues.get(k)?.catch(()=>undefined);await writes.get(k);const raw=await AsyncStorage.getItem(k);key(event,route,scope);if(raw===null)return null;
 const r=JSON.parse(raw);if(r?.version!==1||r.userId!==scope.userId||r.eventId!==event||r.routeId!==route)throw Error('Your extra draft could not be read.');valid(r.value,event,route);
 return {raw,value:r.value as CreatorAddonRecord};
}
/** Register the complete queued form write immediately so a reopened editor waits for it. */
export function queueCreatorAddonDraft<T>(event:string,route:string,scope:CreatorPageScope,work:()=>Promise<T>){
 const k=key(event,route,scope);const next=(draftQueues.get(k)??Promise.resolve()).catch(()=>undefined).then(work);draftQueues.set(k,next);
 return next.finally(()=>{if(draftQueues.get(k)===next)draftQueues.delete(k);});
}
export function writeCreatorAddonDraft(event:string,route:string,scope:CreatorPageScope,value:CreatorAddonRecord,expected:string|null){
 const k=key(event,route,scope);valid(value,event,route);const raw=JSON.stringify({version:1,userId:scope.userId,eventId:event,routeId:route,value});
 return ordered(k,async()=>{key(event,route,scope);if(await AsyncStorage.getItem(k)!==expected)throw Error('Another visit changed this extra draft. Keep this editor open.');key(event,route,scope);await AsyncStorage.setItem(k,raw);return raw;});
}
export function clearCreatorAddonDraft(event:string,route:string,scope:CreatorPageScope,expected:string|null){
 const k=key(event,route,scope);return ordered(k,async()=>{key(event,route,scope);if(await AsyncStorage.getItem(k)!==expected)throw Error('A newer extra draft is still on this device.');key(event,route,scope);if(expected!==null)await AsyncStorage.removeItem(k);});
}
