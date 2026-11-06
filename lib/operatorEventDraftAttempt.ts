import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { mediaUUID } from './creatorPageEventMedia';
import { validOperatorDraftInput, operatorDraftReceiptMatches, type OperatorDraftInput, type OperatorDraftOutcome } from './operatorEventDraft';

export interface OperatorDraftAttempt { version:1; userId:string; requestId:string; input:OperatorDraftInput }
const queues=new Map<string,Promise<unknown>>();
const key=(communityId:string|null,scope:CreatorPageScope)=>`operator-event-draft:v1:${scope.userId}:${communityId??'organization'}`;
function current(communityId:string|null,scope:CreatorPageScope){
  if(!mediaUUID(scope.userId)||!scope.isCurrent()||!(communityId===null||mediaUUID(communityId)))throw new CreatorPageScopeExpired();
}
async function serial<T>(k:string,action:()=>Promise<T>):Promise<T>{
  const next=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(action);queues.set(k,next);
  try{return await next;}finally{if(queues.get(k)===next)queues.delete(k);}
}
async function read(communityId:string|null,scope:CreatorPageScope):Promise<OperatorDraftAttempt|null>{
  current(communityId,scope);const raw=await AsyncStorage.getItem(key(communityId,scope));current(communityId,scope);
  if(raw===null)return null;
  const value=JSON.parse(raw) as OperatorDraftAttempt;
  if(!value||value.version!==1||value.userId!==scope.userId||!mediaUUID(value.requestId)||!validOperatorDraftInput(value.input)||value.input.communityId!==communityId){
    throw Error('The original draft save needs to be checked before creating another event.');
  }
  return value;
}
export function readOperatorDraftAttempt(communityId:string|null,scope:CreatorPageScope){return serial(key(communityId,scope),()=>read(communityId,scope));}
/** Persist an immutable complete input before dispatch. Existing attempts are
 * returned for recovery, never silently replaced by the newly typed form.
 */
export function prepareOperatorDraftAttempt(input:OperatorDraftInput,scope:CreatorPageScope){
  current(input.communityId,scope);if(!validOperatorDraftInput(input))throw Error('Check the draft and RSVP settings.');
  const snapshot=JSON.parse(JSON.stringify(input)) as OperatorDraftInput;
  return serial(key(snapshot.communityId,scope),async()=>{
    const existing=await read(snapshot.communityId,scope);if(existing)return {attempt:existing,created:false};
    const attempt:OperatorDraftAttempt={version:1,userId:scope.userId,requestId:Crypto.randomUUID(),input:snapshot};
    current(snapshot.communityId,scope);await AsyncStorage.setItem(key(snapshot.communityId,scope),JSON.stringify(attempt));current(snapshot.communityId,scope);
    return {attempt,created:true};
  });
}
/** Only an exact confirmed creation or sealed cancellation releases the local attempt.
 * There is deliberately no "clear unknown and create again" path.
 */
export function completeOperatorDraftAttempt(attempt:OperatorDraftAttempt,saved:OperatorDraftOutcome,scope:CreatorPageScope){
  current(attempt.input.communityId,scope);
  if(attempt.userId!==scope.userId||saved.userId!==scope.userId||saved.requestId!==attempt.requestId||saved.version!==1||(saved.status==='Draft'?!mediaUUID(saved.eventId):saved.status!=='Cancelled'||saved.eventId!==null)||!Number.isFinite(Date.parse(saved.createdAt))||!operatorDraftReceiptMatches(saved,attempt.input)){
    throw Error('Check the original draft save before continuing.');
  }
  return serial(key(attempt.input.communityId,scope),async()=>{
    const pending=await read(attempt.input.communityId,scope);
    if(!pending||JSON.stringify(pending)!==JSON.stringify(attempt))return false;
    current(attempt.input.communityId,scope);await AsyncStorage.removeItem(key(attempt.input.communityId,scope));current(attempt.input.communityId,scope);return true;
  });
}
