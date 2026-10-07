/** Page/account-owned admission recovery. Contact and answers remain in memory;
 * only an attempt ID, question version and answer fingerprint persist locally. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { validateJoinAnswers, type JoinAnswers, type JoinGate, type MembershipStatus } from './communityJoin';
export interface CreatorCommunityJoinGate extends JoinGate { creatorPageVersion: number; creatorPagePolicy: 'open' | 'approval_required'; }
export interface CommunityJoinAttempt { id: string; pageId: string; userId: string; version: number; answerHash: string; }
export interface CommunityJoinReceipt { id: string; page_id: string; user_id: string; settings_version: number | null; member_id: string | null; outcome: 'submitted' | 'cancelled'; current_status: MembershipStatus | null; created_at: string; }
export interface OwnCommunityMembership { id: string; status: MembershipStatus; role: string; }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses=['pending','active','left','removed','banned','declined'];
const key=(pageId:string,scope:CreatorPageScope)=>`creator-community-join:v1:${scope.userId}:${pageId}`;
const busy=new Set<string>();
const current=(scope:CreatorPageScope)=>{if(!scope.isCurrent())throw new CreatorPageScopeExpired();};
async function account(scope:CreatorPageScope){current(scope);const r=await supabase.auth.getUser();current(scope);if(r.error||r.data.user?.id!==scope.userId)throw new CreatorPageScopeExpired();}
function identity(pageId:string,scope:CreatorPageScope){current(scope);if(!uuid.test(pageId)||!uuid.test(scope.userId))throw Error('This community address is invalid.');}
async function exclusive<T>(pageId:string,scope:CreatorPageScope,run:()=>Promise<T>){identity(pageId,scope);const k=key(pageId,scope);if(busy.has(k))throw Error('Your joining request is still being checked.');busy.add(k);try{return await run();}finally{busy.delete(k);}}
function attempt(value:unknown,pageId:string,scope:CreatorPageScope):CommunityJoinAttempt{const a=value as CommunityJoinAttempt;if(!a||!uuid.test(a.id)||a.pageId!==pageId||a.userId!==scope.userId||!Number.isSafeInteger(a.version)||a.version<0||!/^[0-9a-f]{64}$/.test(a.answerHash))throw Error('Your saved request could not be read.');return a;}
function receipt(value:unknown,a:CommunityJoinAttempt):CommunityJoinReceipt{const r=value as CommunityJoinReceipt;if(!r||r.id!==a.id||r.page_id!==a.pageId||r.user_id!==a.userId||!['submitted','cancelled'].includes(r.outcome)||!(r.current_status===null||statuses.includes(r.current_status))||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at))|| (r.outcome==='submitted'&&(r.settings_version!==a.version||!r.member_id||!uuid.test(r.member_id)))|| (r.outcome==='cancelled'&&(r.member_id!==null||r.settings_version!==null||r.current_status!==null)))throw Error('Your joining result could not be confirmed.');return r;}
/** One row supplies all questions and its version; an unavailable read never disables required questions. */
export async function readCreatorCommunityJoinGate(pageId:string,scope:CreatorPageScope):Promise<CreatorCommunityJoinGate|null>{
 identity(pageId,scope);await account(scope);
 const p=await supabase.from('creator_page_publications').select('page_id,page_kind').eq('page_id',pageId).maybeSingle();await account(scope);if(p.error)throw p.error;if(!p.data)return null;if(p.data.page_id!==pageId||p.data.page_kind!=='community')throw Error('This is not a community page.');
 const r=await supabase.from('communities').select('id,name,join_welcome_message,join_intro_question,guidelines_url,join_policy,join_ask_reason,join_ask_source,join_ask_rules_confirm,join_open_question,creator_page_join_settings_version').eq('id',pageId).eq('status','active').maybeSingle();await account(scope);if(r.error)throw r.error;const v=r.data;
 if(!v||v.id!==pageId||typeof v.name!=='string'||!['open','approval_required'].includes(v.join_policy)||!Number.isSafeInteger(v.creator_page_join_settings_version)||v.creator_page_join_settings_version<0||!(['join_ask_reason','join_ask_source','join_ask_rules_confirm'] as const).every(k=>typeof v[k]==='boolean')||!(['join_welcome_message','join_intro_question','guidelines_url','join_open_question'] as const).every(k=>v[k]===null||typeof v[k]==='string'))throw Error('These joining questions are unavailable. Please try again.');
 return {communityId:pageId,name:v.name,welcomeMessage:v.join_welcome_message,introQuestion:v.join_intro_question,guidelinesUrl:v.guidelines_url,askReason:v.join_ask_reason,askSource:v.join_ask_source,askRulesConfirm:v.join_ask_rules_confirm,openQuestion:v.join_open_question?.trim()||null,creatorPageVersion:v.creator_page_join_settings_version,creatorPagePolicy:v.join_policy};
}
export async function readOwnCommunityMembership(pageId:string,scope:CreatorPageScope):Promise<OwnCommunityMembership|null>{identity(pageId,scope);await account(scope);const r=await supabase.from('community_members').select('id,community_id,user_id,status,role').eq('community_id',pageId).eq('user_id',scope.userId).maybeSingle();await account(scope);if(r.error)throw r.error;if(!r.data)return null;const m=r.data;if(!uuid.test(m.id)||m.community_id!==pageId||m.user_id!==scope.userId||!statuses.includes(m.status)||typeof m.role!=='string')throw Error('Your membership could not be checked.');return {id:m.id,status:m.status,role:m.role};}
export async function readCommunityJoinAttempt(pageId:string,scope:CreatorPageScope){identity(pageId,scope);const raw=await AsyncStorage.getItem(key(pageId,scope));current(scope);if(!raw)return null;try{return attempt(JSON.parse(raw),pageId,scope);}catch{throw Error('Your saved request could not be read.');}}
function normalized(a:JoinAnswers):JoinAnswers{return {first_name:a.first_name.trim(),last_name:a.last_name.trim(),email:a.email.trim(),zip:a.zip.trim(),intro_answer:a.intro_answer.trim(),guidelines_accepted:a.guidelines_accepted,...(a.reason_answer!==undefined?{reason_answer:a.reason_answer.trim()}:{}),...(a.source_answer!==undefined?{source_answer:a.source_answer.trim()}:{}),...(a.rules_confirmed!==undefined?{rules_confirmed:a.rules_confirmed}:{}),...(a.open_answer!==undefined?{open_answer:a.open_answer.trim()}: {})};}
async function readReceipt(a:CommunityJoinAttempt,scope:CreatorPageScope){await account(scope);const r=await supabase.rpc('get_creator_community_join_request',{p_page_id:a.pageId,p_request_id:a.id});await account(scope);if(r.error)throw r.error;return r.data===null?null:receipt(r.data,a);}
export async function checkCommunityJoinRequest(pageId:string,scope:CreatorPageScope){return exclusive(pageId,scope,async()=>{const a=await readCommunityJoinAttempt(pageId,scope);return a?readReceipt(a,scope):null;});}
/** Explicit cancellation returns an already-committed admission without undoing it. */
export async function cancelCommunityJoinRequest(pageId:string,scope:CreatorPageScope){return exclusive(pageId,scope,async()=>{const a=await readCommunityJoinAttempt(pageId,scope);if(!a)throw Error('There is no interrupted request to check.');await account(scope);const r=await supabase.rpc('cancel_creator_community_join_request',{p_page_id:pageId,p_request_id:a.id});await account(scope);if(r.error)throw r.error;return receipt(r.data,a);});}
/** Only a verified receipt permits retiring the local attempt. A missing server row is still unknown. */
export async function finishCommunityJoinRequest(pageId:string,scope:CreatorPageScope){return exclusive(pageId,scope,async()=>{const a=await readCommunityJoinAttempt(pageId,scope);if(!a)return null;const r=await readReceipt(a,scope);if(!r)throw Error('This request is still unconfirmed. Check its status before starting another.');await account(scope);await AsyncStorage.removeItem(key(pageId,scope));current(scope);return r;});}
export async function sendCommunityJoinRequest(gate:CreatorCommunityJoinGate,answers:JoinAnswers,scope:CreatorPageScope){return exclusive(gate.communityId,scope,async()=>{
 const payload=normalized(answers),problem=validateJoinAnswers(payload,gate);if(problem)throw Error(problem);await account(scope);
 const fingerprint=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify(payload));current(scope);
 let a=await readCommunityJoinAttempt(gate.communityId,scope);
 if(a&&(a.version!==gate.creatorPageVersion||a.answerHash!==fingerprint))throw Error('An earlier request is still unconfirmed. Check or cancel that request before changing its answers.');
 if(!a){a={id:Crypto.randomUUID(),pageId:gate.communityId,userId:scope.userId,version:gate.creatorPageVersion,answerHash:fingerprint};attempt(a,gate.communityId,scope);await AsyncStorage.setItem(key(gate.communityId,scope),JSON.stringify(a));current(scope);}
 await account(scope);
 const r=await supabase.rpc('request_creator_community_join',{p_page_id:a.pageId,p_request_id:a.id,p_settings_version:a.version,p_answers:payload});
 await account(scope);if(r.error)throw r.error;return receipt(r.data,a);
 });}
