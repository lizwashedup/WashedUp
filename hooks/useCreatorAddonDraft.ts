import {useEffect,useMemo,useReducer,useRef} from 'react';
import {randomUUID} from 'expo-crypto';
import {loadCreatorAddon,type CreatorAddon} from '../lib/creatorAddonEditor';
import type {CreatorPageScope} from '../lib/creatorPageReview';
import type {AddonDraft} from '../lib/ticketPromosAddons';
import type {CreatorAddonPhoto} from '../lib/creatorAddonPhoto';
import {readCreatorAddonDraft,writeCreatorAddonDraft,clearCreatorAddonDraft,queueCreatorAddonDraft,type CreatorAddonRecord,type CreatorAddonForm} from '../lib/creatorAddonDraft';

export function useCreatorAddonDraft(eventId:string,routeId:string,scope:CreatorPageScope,visible:boolean){
 const [,render]=useReducer(n=>n+1,0);
 const state=useMemo(()=>({value:null as CreatorAddonRecord|null,raw:null as string|null,loaded:false,loading:false,error:'',queue:Promise.resolve(),revision:0}),[eventId,routeId,scope,visible]);
 const latest=useRef(state);latest.current=state;const mounted=useRef(false);
 const current=()=>mounted.current&&latest.current===state&&visible&&scope.isCurrent();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const load=async()=>{
  if(!current()||state.loaded||state.loading)return;state.loading=true;state.error='';render();
  try{
   const saved=await readCreatorAddonDraft(eventId,routeId,scope);
   const row=!saved&&routeId!=='new'?await loadCreatorAddon(eventId,routeId,scope):null;
   if(!current())return;
   state.raw=saved?.raw??null;
   state.value=saved?.value??{recordId:row?.id??randomUUID(),baseline:row,pending:null,confirmed:false,dispatched:false,form:{name:row?.name??'',description:row?.description??'',priceText:row?.price_cents?(row.price_cents/100).toFixed(2):'',imageUrl:row?.image_url??'',capText:row?.quantity_cap?String(row.quantity_cap):'',perOrderMaxText:row?.per_order_max?String(row.per_order_max):'',options:row?.variations??[]}};
   state.loaded=true;
  }catch{if(current())state.error='Your extra or device draft couldn’t be loaded. Try again.';}
  finally{state.loading=false;if(current())render();}
 };
 useEffect(()=>{void load();},[state]);
 const persist=async(value:CreatorAddonRecord)=>{
  if(!current()||!state.loaded)return false;
  const snapshot=JSON.parse(JSON.stringify(value)) as CreatorAddonRecord;
  state.value=snapshot;state.error='';const revision=++state.revision;render();
  const write=queueCreatorAddonDraft(eventId,routeId,scope,async()=>{state.raw=await writeCreatorAddonDraft(eventId,routeId,scope,snapshot,state.raw);});state.queue=write;
  try{await write;return current();}catch{if(state.revision===revision)state.error='Couldn’t keep your extra on this device. Try again before leaving.';return false;}
  finally{if(current())render();}
 };
 return {...state,ready:state.loaded&&!!state.value&&current(),
  change(k:keyof CreatorAddonForm,update:unknown){
   if(!current()||!state.value||state.value.pending||state.value.confirmed)return;
   const old=state.value.form[k];const value=typeof update==='function'?update(old):update;
   void persist({...state.value,form:{...state.value.form,[k]:value}});
  },
  async prepare(draft:AddonDraft){if(!state.value)return null;const value={...state.value,pending:state.value.pending??draft,dispatched:state.value.pending?(state.value.dispatched??true):false};return await persist(value)?value:null;},
  async preparePhoto(photo:CreatorAddonPhoto){if(!current()||!state.value||state.value.pending||state.value.confirmed)return false;return persist({...state.value,photo});},
  async finishPhoto(photo:CreatorAddonPhoto,url:string){
   if(!current()||!state.value||state.value.photo?.id!==photo.id||state.value.photo.uri!==photo.uri||state.value.pending)return false;
   return persist({...state.value,photo:null,form:{...state.value.form,imageUrl:url}});
  },
  async cancelPhoto(photo:CreatorAddonPhoto){
   if(!current()||!state.value||state.value.photo?.id!==photo.id||state.value.photo.uri!==photo.uri||state.value.pending)return false;
   return persist({...state.value,photo:null});
  },
  async markDispatched(){if(!current()||!state.value?.pending)return false;return await persist({...state.value,dispatched:true})&&current();},
  async releaseRejected(){if(!current()||!state.value?.pending||state.value.confirmed)return false;return persist({...state.value,pending:null,dispatched:false});},
  async settleChanged(){if(!current()||!state.value?.pending||state.value.confirmed)return false;return persist({...state.value,dispatched:false});},
  async useSaved(row:CreatorAddon){
   if(!current()||!state.value||state.value.confirmed||state.value.dispatched!==false||routeId==='new'||row.id!==state.value.recordId||row.event_id!==eventId)return false;
   return persist({...state.value,baseline:row,pending:null,dispatched:false,form:{name:row.name,description:row.description??'',priceText:row.price_cents?(row.price_cents/100).toFixed(2):'',imageUrl:row.image_url??'',capText:row.quantity_cap?String(row.quantity_cap):'',perOrderMaxText:row.per_order_max?String(row.per_order_max):'',options:row.variations}});
  },
  async finish(){
   if(!current()||!state.value||!await persist({...state.value,confirmed:true}))return false;
   try{await clearCreatorAddonDraft(eventId,routeId,scope,state.raw);state.raw=null;return current();}
   catch{state.error='Your extra is saved. Try again to finish clearing its device draft.';if(current())render();return false;}
  },
  save:()=>state.value?persist(state.value):Promise.resolve(false),retry:()=>state.loaded&&state.value?persist(state.value):load(),
 };
}
