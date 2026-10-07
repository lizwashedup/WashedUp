/**
 * The door: check a reference_code in through record_ticket_checkin (spec 100
 * P0 #5). That RPC is the ONLY write path (ticket_checkins has no INSERT RLS);
 * it is organizer-gated, row-locks the seat, and returns the verdict. This
 * module distinguishes a real server VERDICT from a bad SIGNAL: only a signal
 * failure is ever queued locally and synced later. A verdict, even 'voided' or
 * a bad code, is an answer and never queues.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { assertTicketVisit, ticketReadAuthorization, canReadCreatorTickets } from './creatorTicketRead';

export type CheckinResult = 'admitted' | 'duplicate' | 'voided';

export type CheckinOutcome =
  | { kind: 'result'; result: CheckinResult; code: string; admittedAt: string | null }
  | { kind: 'unknown'; code: string }
  | { kind: 'queued'; code: string }
  | { kind: 'error'; message: string; code: string };

/**
 * record_ticket_checkin's return GREW from bare text to a small jsonb envelope
 * {result, admitted_at} (Screen 30: a duplicate scan now carries the original
 * admitted timestamp instead of nothing). Read both shapes rather than assume
 * the new one -- a mobile rollout can leave some installed app builds talking
 * to an already-migrated database for a while, and the reverse (this code
 * against a not-yet-migrated database) is also possible mid-rollout; either
 * way a bare-string legacy reply must still parse to a correct verdict.
 */
function parseCheckinPayload(data: unknown): { result: CheckinResult; admittedAt: string | null } {
  if (typeof data === 'string') return { result: data as CheckinResult, admittedAt: null };
  const obj = (data ?? {}) as { result?: CheckinResult; admitted_at?: string | null };
  return { result: obj.result as CheckinResult, admittedAt: obj.admitted_at ?? null };
}

const QUEUE_KEY = 'ticket_checkin_queue_v1';
const DEVICE_KEY_STORAGE = 'ticket_checkin_device_key_v1';

/**
 * The buyer QR opens the public event when scanned with a phone camera and
 * carries the admission reference in `ticket`. The in-app creator scanner
 * extracts that reference before calling the existing RPC. Typed codes keep
 * the original trim-and-uppercase behavior.
 */
export function normalizeCode(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:' && /(^|\.)washedup\.app$/i.test(url.hostname)) {
      const ticket = url.searchParams.get('ticket');
      if (ticket) return ticket.trim().toUpperCase();
    }
  } catch {
    // A typed reference is expected to be a plain string, not a URL.
  }
  return trimmed.toUpperCase();
}

interface QueuedCheckin { code: string; queuedAt: string; signature: string; }

/**
 * Spec (Creator Space inventory, C-23): "offline check-in queues signed
 * local records". record_ticket_checkin stays the one real trust boundary
 * (organizer-gated, row-locks the seat) -- this signature only catches a
 * corrupted/tampered local queue before it gets replayed, one random key
 * per device, generated once and reused.
 */
let deviceKeyRead: Promise<string> | null = null;
async function getDeviceKey(): Promise<string> {
  if (!deviceKeyRead) deviceKeyRead = (async () => {
    let key = await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) { key = Crypto.randomUUID(); await AsyncStorage.setItem(DEVICE_KEY_STORAGE, key); }
    return key;
  })();
  const pending=deviceKeyRead;
  try { return await pending; } finally { if(deviceKeyRead===pending)deviceKeyRead=null; }
}

async function signRecord(code: string, queuedAt: string): Promise<string> {
  const deviceKey = await getDeviceKey();
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${deviceKey}:${code}:${queuedAt}`);
}

async function readQueue(): Promise<QueuedCheckin[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function writeQueue(q: QueuedCheckin[]): Promise<void> {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* best effort */ }
}

export async function queuedCount(context?: CheckinContext): Promise<number> {
  if (context) return (await listQueued(context)).length;
  return (await readQueue()).length;
}

export interface QueuedCheckinView { code: string; queuedAt: string; }

/** The offline door list: every code still waiting on a sync, oldest first. Never exposes the signature. */
export async function listQueued(context?: CheckinContext): Promise<QueuedCheckinView[]> {
  if (context) return withCheckinQueue(context, async () => (await readScopedQueue(context)).map(({code,queuedAt})=>({code,queuedAt})));
  return (await readQueue())
    .map(({ code, queuedAt }) => ({ code, queuedAt }))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/**
 * One RPC attempt, WITHOUT touching the queue. A verdict (admitted/duplicate/
 * voided), a bad code (unknown), or an auth error is returned as-is; only a
 * genuine signal failure comes back as 'queued' so the caller can decide.
 */
async function attempt(code: string): Promise<CheckinOutcome> {
  try {
    const { data, error } = await supabase.rpc('record_ticket_checkin', { p_reference_code: code });
    if (!error) {
      const { result, admittedAt } = parseCheckinPayload(data);
      return { kind: 'result', result, code, admittedAt };
    }
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('unknown reference')) return { kind: 'unknown', code };
    if (msg.includes('organizer') || msg.includes('authenticated')) {
      return { kind: 'error', message: 'you are not the organizer for this event.', code };
    }
    // a PostgREST error carrying a code is a real server refusal, not bad signal
    if ((error as { code?: string }).code) {
      return { kind: 'error', message: 'that did not go through. try again.', code };
    }
    // no pg code: a fetch / abort / timeout shape = bad signal
    return { kind: 'queued', code };
  } catch {
    // the 8s abort in supabase.ts throws on a dead socket = bad signal
    return { kind: 'queued', code };
  }
}

/**
 * The door path. On bad signal the code is queued and confirmed on the next
 * sync; a real verdict or bad code is returned immediately.
 */
export async function recordCheckin(rawCode: string, context?: CheckinContext): Promise<CheckinOutcome> {
  if (context) return recordScopedCheckin(rawCode, context);
  const code = normalizeCode(rawCode);
  if (!code) return { kind: 'error', message: 'enter a code.', code };
  const outcome = await attempt(code);
  if (outcome.kind === 'queued') {
    const q = await readQueue();
    if (!q.some((x) => x.code === code)) {
      const queuedAt = new Date().toISOString();
      const signature = await signRecord(code, queuedAt);
      q.push({ code, queuedAt, signature });
      await writeQueue(q);
    }
  }
  return outcome;
}

export interface SyncSummary {
  processed: { code: string; outcome: CheckinOutcome }[];
  remaining: number;
}

/**
 * Drain the queue when signal returns. Keeps only codes that STILL fail on
 * signal; anything that reached a verdict (even 'voided'/'unknown') leaves the
 * queue. Order preserved so an audit reads chronologically. A record whose
 * signature no longer matches (corrupted/tampered local storage) is treated
 * as resolved-with-a-refusal rather than replayed blind or retried forever.
 */
export async function syncQueuedCheckins(context?: CheckinContext): Promise<SyncSummary> {
  if (context) return syncScopedCheckins(context);
  const q = await readQueue();
  const stillQueued: QueuedCheckin[] = [];
  const processed: { code: string; outcome: CheckinOutcome }[] = [];
  for (const item of q) {
    const expected = await signRecord(item.code, item.queuedAt);
    if (expected !== item.signature) {
      processed.push({
        code: item.code,
        outcome: { kind: 'error', message: 'that queued check-in did not verify. scan again.', code: item.code },
      });
      continue;
    }
    const outcome = await attempt(item.code);
    if (outcome.kind === 'queued') stillQueued.push(item);
    else processed.push({ code: item.code, outcome });
  }
  await writeQueue(stillQueued);
  return { processed, remaining: stillQueued.length };
}


/** Current native visits never claim ownership of the legacy device-wide v1 queue. */
export interface CheckinContext { eventId: string; pageId: string | null; scope: CreatorPageScope; }
const checkinQueues = new Map<string, Promise<unknown>>();
const uuid = (value: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function scopedQueueKey(context: CheckinContext): string {
  assertTicketVisit(context.scope);
  if (!uuid(context.eventId) || !uuid(context.scope.userId) || (context.pageId !== null && !uuid(context.pageId))) throw new Error('Check-in context could not be verified.');
  return `ticket_checkin_queue_v2:${context.scope.userId}:${context.eventId}`;
}
function withCheckinQueue<T>(context: CheckinContext, work: () => Promise<T>): Promise<T> {
  const key = scopedQueueKey(context);
  const previous = checkinQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => { assertTicketVisit(context.scope); return work(); });
  checkinQueues.set(key, next);
  void next.finally(() => { if(checkinQueues.get(key) === next) checkinQueues.delete(key); }).catch(() => undefined);
  return next;
}
async function scopedSignature(context: CheckinContext, code: string, queuedAt: string): Promise<string> {
  // The complete account/event/page identity is covered by the existing device signature.
  return signRecord(`${context.scope.userId}:${context.eventId}:${context.pageId ?? ''}:${code}`, queuedAt);
}
async function readScopedQueue(context: CheckinContext): Promise<QueuedCheckin[]> {
  const raw = await AsyncStorage.getItem(scopedQueueKey(context));
  assertTicketVisit(context.scope);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error('Saved check-ins could not be read.');
  for (const row of parsed) {
    if (!row || typeof row.code !== 'string' || !row.code || normalizeCode(row.code) !== row.code || typeof row.queuedAt !== 'string' || !Number.isFinite(Date.parse(row.queuedAt)) || typeof row.signature !== 'string' || row.signature !== await scopedSignature(context, row.code, row.queuedAt)) throw new Error('Saved check-ins could not be verified. They have been kept.');
    assertTicketVisit(context.scope);
  }
  return parsed.sort((a,b)=>a.queuedAt.localeCompare(b.queuedAt));
}
async function writeScopedQueue(context: CheckinContext, queue: QueuedCheckin[]): Promise<void> {
  await AsyncStorage.setItem(scopedQueueKey(context), JSON.stringify(queue));
  assertTicketVisit(context.scope);
}
async function scopedAttempt(code: string, context: CheckinContext): Promise<CheckinOutcome> {
  const {scope,eventId,pageId}=context;
  const authorization = await ticketReadAuthorization(scope);
  try {
    // Page events use the already-installed page/event admission transaction.
    // Legacy event codes are checked against their order before the existing admission RPC.
    if (!pageId) {
      const position = await supabase.from('ticket_order_positions')
        .select('id, ticket_orders!inner(event_id)').eq('reference_code',code).maybeSingle()
        .setHeader('Authorization',authorization!);
      assertTicketVisit(scope);
      if (position.error) {
        if (position.error.code) return {kind:'error',code,message:'Ticket details could not be checked. Try again.'};
        return {kind:'queued',code};
      }
      if (!position.data) return {kind:'unknown',code};
      const order = position.data.ticket_orders as unknown as {event_id:string};
      if (order?.event_id !== eventId) return {kind:'error',code,message:'This ticket is for another event. Check the event and code.'};
    }
    const result = pageId
      ? await supabase.rpc('record_creator_page_ticket_checkin',{p_page_id:pageId,p_event_id:eventId,p_reference_code:code}).setHeader('Authorization',authorization!)
      : await supabase.rpc('record_ticket_checkin',{p_reference_code:code}).setHeader('Authorization',authorization!);
    assertTicketVisit(scope);
    if (result.error) {
      const message=(result.error.message??'').toLowerCase();
      if (message.includes('unknown reference')) return {kind:'unknown',code};
      if (result.error.code === '22023') return {kind:'error',code,message:'This ticket is not for this event. Check the event and code.'};
      if (result.error.code === '42501' || message.includes('authenticated') || message.includes('organizer')) return {kind:'error',code,message:'Your access to check in guests could not be confirmed.'};
      if (result.error.code) return {kind:'error',code,message:'Check-in could not be confirmed. Try again.'};
      return {kind:'queued',code};
    }
    const value=parseCheckinPayload(result.data);
    if (!['admitted','duplicate','voided'].includes(value.result) || !(value.admittedAt === null || (typeof value.admittedAt === 'string' && Number.isFinite(Date.parse(value.admittedAt))))) return {kind:'queued',code};
    return {kind:'result',code,...value};
  } catch {
    assertTicketVisit(scope);
    return {kind:'queued',code};
  }
}
async function recordScopedCheckin(raw: string, context: CheckinContext): Promise<CheckinOutcome> {
  const code=normalizeCode(raw);
  if(!code)return{kind:'error',code,message:'Enter a ticket code.'};
  return withCheckinQueue(context,async()=>{
    const queue=await readScopedQueue(context);
    const outcome=await scopedAttempt(code,context);
    if(outcome.kind==='queued'){
      if(!queue.some(row=>row.code===code)){
        const queuedAt=new Date().toISOString();
        queue.push({code,queuedAt,signature:await scopedSignature(context,code,queuedAt)});
      }
      // Never claim a scan was saved if durable storage failed.
      await writeScopedQueue(context,queue);
    } else if((outcome.kind==='result'||outcome.kind==='unknown') && queue.some(row=>row.code===code)) {
      await writeScopedQueue(context,queue.filter(row=>row.code!==code));
    }
    return outcome;
  });
}
async function syncScopedCheckins(context: CheckinContext): Promise<SyncSummary> {
  return withCheckinQueue(context,async()=>{
    const queue=await readScopedQueue(context),processed:SyncSummary['processed']=[];
    const remaining=[...queue];
    for(const item of queue){
      const outcome=await scopedAttempt(item.code,context);
      assertTicketVisit(context.scope);
      if(outcome.kind==='result'||outcome.kind==='unknown'){
        remaining.splice(remaining.findIndex(row=>row.code===item.code),1);
        await writeScopedQueue(context,remaining);
        processed.push({code:item.code,outcome});
      } else if(outcome.kind==='error'){
        // Access/refusal can change; retain the original scan instead of silently discarding it.
        processed.push({code:item.code,outcome});
        break;
      }
    }
    return {processed,remaining:remaining.length};
  });
}


async function legacySignature(code: string, queuedAt: string): Promise<string> {
  const key=await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
  if(!key)throw new Error('Earlier saved scans could not be verified. They have been kept.');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`${key}:${code}:${queuedAt}`);
}

/** Read-only recovery preview: only signed old scans the backend matches to this event. */
export async function readLegacyCheckins(context: CheckinContext): Promise<QueuedCheckinView[]> {
  scopedQueueKey(context);
  const raw=await AsyncStorage.getItem(QUEUE_KEY);
  assertTicketVisit(context.scope);
  if(!raw)return [];
  const rows:unknown=JSON.parse(raw);
  if(!Array.isArray(rows))throw new Error('Earlier saved scans could not be read. They have been kept.');
  if(!await canReadCreatorTickets(context.eventId,context.scope))throw new Error('Check-in access could not be confirmed.');
  const candidates:QueuedCheckin[]=[];
  for(const row of rows){
    if(!row || typeof row.code!=='string' || !row.code || normalizeCode(row.code)!==row.code || typeof row.queuedAt!=='string' || !Number.isFinite(Date.parse(row.queuedAt)) || typeof row.signature!=='string')continue;
    if(row.signature===await legacySignature(row.code,row.queuedAt))candidates.push(row);
    assertTicketVisit(context.scope);
  }
  const codes=[...new Set(candidates.map(row=>row.code))],matched=new Set<string>();
  const authorization=await ticketReadAuthorization(context.scope);
  for(let offset=0;offset<codes.length;offset+=40){
    const batch=codes.slice(offset,offset+40);
    const result=await supabase.from('ticket_order_positions')
      .select('reference_code, ticket_orders!inner(event_id)').in('reference_code',batch)
      .eq('ticket_orders.event_id',context.eventId).setHeader('Authorization',authorization!);
    assertTicketVisit(context.scope);
    if(result.error||!Array.isArray(result.data))throw new Error('Earlier scans could not be matched to this event. Try again.');
    for(const position of result.data){
      if(!batch.includes(position.reference_code) || (position.ticket_orders as unknown as {event_id:string})?.event_id!==context.eventId)throw new Error('Earlier scans could not be verified.');
      matched.add(position.reference_code);
    }
  }
  return candidates.filter(row=>matched.has(row.code)).map(({code,queuedAt})=>({code,queuedAt}));
}
let legacyRecovery:Promise<unknown>=Promise.resolve();
/** Explicit creator confirmation only. A preview, mount or empty result never replays old scans. */
export function confirmLegacyCheckins(context: CheckinContext, expected: QueuedCheckinView[]): Promise<SyncSummary> {
  const next=legacyRecovery.catch(()=>undefined).then(async()=>{
    const matched=await readLegacyCheckins(context);
    const selected=matched.filter(row=>expected.some(item=>item.code===row.code && item.queuedAt===row.queuedAt));
    if(selected.length!==expected.length)throw new Error('Saved scans changed. Review them again.');
    const processed:SyncSummary['processed']=[];let remaining=selected.length;
    for(const row of selected){
      assertTicketVisit(context.scope);
      const outcome=await recordCheckin(row.code,context);
      processed.push({code:row.code,outcome});
      if(outcome.kind!=='result')break;
      // Delete only the exact signed record after an authoritative admission/duplicate/void result.
      // Re-read so records added since the preview are preserved.
      const raw=await AsyncStorage.getItem(QUEUE_KEY);
      const currentRows:unknown=raw?JSON.parse(raw):[];
      if(!Array.isArray(currentRows))throw new Error('Earlier saved scans could not be updated. They have been kept.');
      const signature=await legacySignature(row.code,row.queuedAt);
      const kept=currentRows.filter(item=>!(item?.code===row.code && item?.queuedAt===row.queuedAt && item?.signature===signature));
      assertTicketVisit(context.scope);
      await AsyncStorage.setItem(QUEUE_KEY,JSON.stringify(kept));
      assertTicketVisit(context.scope);
      remaining--;
    }
    return {processed,remaining};
  });
  legacyRecovery=next;
  return next;
}
