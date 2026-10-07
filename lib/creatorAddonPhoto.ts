import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {encode} from 'base64-arraybuffer';
import {AppState} from 'react-native';
import {supabase,SUPABASE_URL,SUPABASE_ANON_KEY} from './supabase';
import {assertTicketVisit,canReadCreatorTickets,ticketReadAuthorization} from './creatorTicketRead';
import type {CreatorPageScope} from './creatorPageReview';

export interface CreatorAddonPhoto {id:string;uri:string}
const uuid=(v:string)=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function localPath(eventId:string,id:string,scope:CreatorPageScope){
 assertTicketVisit(scope);
 if(!FileSystem.documentDirectory||![eventId,id,scope.userId].every(uuid))throw Error('The original photo is unavailable.');
 return `${FileSystem.documentDirectory}creator-extra-photos/${scope.userId}/${eventId}/${id}.jpg`;
}
export async function keepCreatorAddonPhoto(eventId:string,source:string,scope:CreatorPageScope):Promise<CreatorAddonPhoto>{
 const id=Crypto.randomUUID(),uri=localPath(eventId,id,scope);
 if(!source.startsWith('file://'))throw Error('Choose the photo again.');
 await FileSystem.makeDirectoryAsync(uri.slice(0,uri.lastIndexOf('/')),{intermediates:true});assertTicketVisit(scope);
 await FileSystem.copyAsync({from:source,to:uri});assertTicketVisit(scope);
 return {id,uri};
}
export async function clearCreatorAddonPhoto(eventId:string,photo:CreatorAddonPhoto,scope:CreatorPageScope){
 if(photo.uri!==localPath(eventId,photo.id,scope))throw Error('This photo belongs to another draft.');
 await FileSystem.deleteAsync(photo.uri,{idempotent:true});
}
/** Same original object and bytes on explicit retry; never overwrite an existing object. */
export async function uploadCreatorAddonPhoto(eventId:string,photo:CreatorAddonPhoto,scope:CreatorPageScope):Promise<string>{
 if(photo.uri!==localPath(eventId,photo.id,scope))throw Error('This photo belongs to another draft.');
 const controller=new AbortController();let task:FileSystem.UploadTask|null=null;
 const cancel=()=>{controller.abort();void task?.cancelAsync().catch(()=>undefined);};
 const current=()=>{assertTicketVisit(scope);if(controller.signal.aborted)throw Error('The photo upload stopped. Retry the original photo.');};
 const access=async()=>{current();if(!await canReadCreatorTickets(eventId,scope))throw Error('Your access to this extra could not be confirmed.');current();};
 const authorization=(await ticketReadAuthorization(scope))!;
 await access();
 const info=await FileSystem.getInfoAsync(photo.uri);current();
 if(!info.exists||info.isDirectory||!info.size)throw Error('The original photo is no longer on this device. Choose it again.');
 const base64=await FileSystem.readAsStringAsync(photo.uri,{encoding:FileSystem.EncodingType.Base64});current();
 const hash=(value:string)=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value);
 const expected=await hash(base64);current();
 const objectPath=`${scope.userId}/${photo.id}.jpg`,headers={Authorization:authorization,apikey:SUPABASE_ANON_KEY};
 const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==scope.userId||!scope.isCurrent())cancel();});
 const appSubscription=AppState.addEventListener('change',state=>{if(state!=='active')cancel();});
 const timer=setTimeout(cancel,60000);
 try{
  const check=async()=>{
   current();const result=await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/event-images/${objectPath}`,{headers,signal:controller.signal,cache:'no-store'});current();
   if(result.status===404)return false;
   if(result.status===400){const detail=await result.json().catch(()=>null);current();if(String(detail?.statusCode)==='404'||['NoSuchKey','not_found'].includes(detail?.code))return false;}
   if(!result.ok)throw Error('The saved photo could not be checked. Retry the original photo.');
   const bytes=await result.arrayBuffer();current();
   if(bytes.byteLength!==info.size||await hash(encode(bytes))!==expected)throw Error('The saved photo differs. Choose the photo again.');
   current();return true;
  };
  if(!await check()){
   await access();current();
   task=FileSystem.createUploadTask(`${SUPABASE_URL}/storage/v1/object/event-images/${objectPath}`,photo.uri,{httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,sessionType:FileSystem.FileSystemSessionType.FOREGROUND,headers:{...headers,'Content-Type':'image/jpeg','x-upsert':'false'}});
   try{await task.uploadAsync();}catch{current();}
   if(!await check())throw Error('The photo was not saved. Retry the original photo.');
  }
  await access();current();return `${SUPABASE_URL}/storage/v1/object/public/event-images/${objectPath}`;
 }finally{clearTimeout(timer);subscription.unsubscribe();appSubscription.remove();}
}
