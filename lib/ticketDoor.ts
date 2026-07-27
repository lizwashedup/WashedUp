/**
 * The door: check a reference_code in through record_ticket_checkin (spec 100
 * P0 #5). That RPC is the ONLY write path (ticket_checkins has no INSERT RLS);
 * it is organizer-gated, row-locks the seat, and returns the verdict. This
 * module distinguishes a real server VERDICT from a bad SIGNAL: only a signal
 * failure is ever queued locally and synced later. A verdict, even 'voided' or
 * a bad code, is an answer and never queues.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type CheckinResult = 'admitted' | 'duplicate' | 'voided';

export type CheckinOutcome =
  | { kind: 'result'; result: CheckinResult; code: string }
  | { kind: 'unknown'; code: string }
  | { kind: 'queued'; code: string }
  | { kind: 'error'; message: string; code: string };

const QUEUE_KEY = 'ticket_checkin_queue_v1';

/** the RPC upper()s and positions store upper; normalize the same way. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

interface QueuedCheckin { code: string; queuedAt: string; }

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

export async function queuedCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * One RPC attempt, WITHOUT touching the queue. A verdict (admitted/duplicate/
 * voided), a bad code (unknown), or an auth error is returned as-is; only a
 * genuine signal failure comes back as 'queued' so the caller can decide.
 */
async function attempt(code: string): Promise<CheckinOutcome> {
  try {
    const { data, error } = await supabase.rpc('record_ticket_checkin', { p_reference_code: code });
    if (!error) return { kind: 'result', result: data as CheckinResult, code };
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
export async function recordCheckin(rawCode: string): Promise<CheckinOutcome> {
  const code = normalizeCode(rawCode);
  if (!code) return { kind: 'error', message: 'enter a code.', code };
  const outcome = await attempt(code);
  if (outcome.kind === 'queued') {
    const q = await readQueue();
    if (!q.some((x) => x.code === code)) {
      q.push({ code, queuedAt: new Date().toISOString() });
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
 * queue. Order preserved so an audit reads chronologically.
 */
export async function syncQueuedCheckins(): Promise<SyncSummary> {
  const q = await readQueue();
  const stillQueued: QueuedCheckin[] = [];
  const processed: { code: string; outcome: CheckinOutcome }[] = [];
  for (const item of q) {
    const outcome = await attempt(item.code);
    if (outcome.kind === 'queued') stillQueued.push(item);
    else processed.push({ code: item.code, outcome });
  }
  await writeQueue(stillQueued);
  return { processed, remaining: stillQueued.length };
}
