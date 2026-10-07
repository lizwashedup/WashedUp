import AsyncStorage from '@react-native-async-storage/async-storage';
import {randomUUID} from 'expo-crypto';
import type {CreatorPageScope} from './creatorPageReview';
import type {TicketAction} from './creatorTicketAction';

export type CreatorExtraRemoval = TicketAction & {kind:'remove-extra';pageId:string;requestId:string};
const queues=new Map<string,Promise<unknown>>();
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
function key(eventId:string,scope:CreatorPageScope){
  if(!scope.isCurrent()||!uuid(eventId)||!uuid(scope.userId))throw Error('This extra visit is unavailable.');
  return `creator-extra-removal:v1:${scope.userId}:${eventId}`;
}
async function serial<T>(k:string,work:()=>Promise<T>){
  const next=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(work);queues.set(k,next);
  try{return await next;}finally{if(queues.get(k)===next)queues.delete(k);}
}
async function read(eventId:string,scope:CreatorPageScope):Promise<CreatorExtraRemoval|null>{
  const raw=await AsyncStorage.getItem(key(eventId,scope));key(eventId,scope);if(raw===null)return null;
  const value=JSON.parse(raw),a=value?.action;
  if(value?.version!==1||value.userId!==scope.userId||!a||a.kind!=='remove-extra'||a.eventId!==eventId
    ||![a.pageId,a.recordId,a.requestId].every(uuid)||typeof a.label!=='string'||a.label.length>200)
    throw Error('The original extra removal could not be read.');
  return a;
}
export function readCreatorExtraRemoval(eventId:string,scope:CreatorPageScope){
  return serial(key(eventId,scope),()=>read(eventId,scope));
}
export function prepareCreatorExtraRemoval(input:TicketAction,scope:CreatorPageScope){
  const k=key(input.eventId,scope);
  if(input.kind!=='remove-extra'||!uuid(input.pageId)||!uuid(input.recordId)||typeof input.label!=='string'||input.label.length>200)
    throw Error('Check the original extra before removing it.');
  const action:CreatorExtraRemoval={...input,kind:'remove-extra',pageId:input.pageId,requestId:randomUUID()};
  return serial(k,async()=>{
    const existing=await read(input.eventId,scope);if(existing)return {action:existing,created:false};
    key(input.eventId,scope);await AsyncStorage.setItem(k,JSON.stringify({version:1,userId:scope.userId,action}));key(input.eventId,scope);
    return {action,created:true};
  });
}
export function clearCreatorExtraRemoval(action:TicketAction,scope:CreatorPageScope){
  return serial(key(action.eventId,scope),async()=>{
    const existing=await read(action.eventId,scope);if(!existing)return;
    if(JSON.stringify(existing)!==JSON.stringify(action))throw Error('A newer extra removal is still on this device.');
    await AsyncStorage.removeItem(key(action.eventId,scope));key(action.eventId,scope);
  });
}
