import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { CommunityOperationScope } from './communityChat';
import { ObsoleteCommunityOperationError } from './communityChat';
import { normalizeCommunityRoomName, type CreatorGroupAttempt, type CreatorGroupReceipt } from './creatorCommunityGroups';
const key = (communityId: string, scope: CommunityOperationScope) => `creator-community-group:v1:${scope.userId}:${communityId}`;
const uuid = (value: string) => /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const queues = new Map<string,Promise<unknown>>();
function current(scope: CommunityOperationScope) { if (!scope.isCurrent()) throw new ObsoleteCommunityOperationError(); }
async function serial<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
  const previous=queues.get(storageKey)??Promise.resolve();
  const next=previous.catch(()=>undefined).then(operation);queues.set(storageKey,next);
  try{return await next;}finally{if(queues.get(storageKey)===next)queues.delete(storageKey);}
}
export async function readCreatorGroupAttempt(communityId: string, scope: CommunityOperationScope): Promise<CreatorGroupAttempt|null> {
  current(scope);const raw=await AsyncStorage.getItem(key(communityId,scope));current(scope);if(!raw)return null;
  const data=JSON.parse(raw);
  if(!data||data.communityId!==communityId||typeof data.requestId!=='string'||!uuid(data.requestId)||typeof data.name!=='string'||normalizeCommunityRoomName(data.name)!==data.name)throw Error('Could not read your saved group.');
  return {communityId,requestId:data.requestId,name:data.name};
}
/** Persist the exact request before any network mutation, including concurrent form openings. */
export async function prepareCreatorGroupAttempt(communityId: string, name: string, scope: CommunityOperationScope): Promise<{ attempt: CreatorGroupAttempt; created: boolean }> {
  if(!uuid(communityId))throw Error('This community is unavailable.');const normalized=normalizeCommunityRoomName(name);
  return serial(key(communityId,scope),async()=>{current(scope);const saved=await readCreatorGroupAttempt(communityId,scope);if(saved)return { attempt: saved, created: false };
    const attempt={communityId,requestId:Crypto.randomUUID(),name:normalized};await AsyncStorage.setItem(key(communityId,scope),JSON.stringify(attempt));current(scope);return { attempt, created: true };
  });
}
/** A confirmed receipt clears only its matching persisted attempt, never another form's work. */
export async function clearCreatorGroupAttempt(receipt: CreatorGroupReceipt, scope: CommunityOperationScope) {
  return serial(key(receipt.communityId,scope),async()=>{current(scope);const saved=await readCreatorGroupAttempt(receipt.communityId,scope);
    if(saved?.requestId!==receipt.requestId||saved.name!==receipt.name)return;
    current(scope);await AsyncStorage.removeItem(key(receipt.communityId,scope));current(scope);
  });
}
