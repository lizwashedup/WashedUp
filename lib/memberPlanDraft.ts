import { compareChatTimestamps } from './chatTimestamp';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export class DraftUnavailable extends Error {}
export class PlanPublishedEarlier extends Error {}

export async function updateOwnedDraft(id: string, viewerId: string, changes: Record<string, unknown>) {
  const { data, error } = await supabase.from('events').update(changes)
    .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft')
    .select('id').maybeSingle();
  if (error) throw error;
  if (data === null) throw new DraftUnavailable();
  if (data?.id !== id) throw new Error('Could not confirm the draft update.');
  return { id };
}

/** A lost response is ambiguous. Confirm the intended field values on the
 * same owned draft without submitting the edit again. Publishing has a
 * separate receipt that checks its request key and resulting status. */
export async function saveExistingPlanDraft(id: string, viewerId: string, fields: Record<string, unknown>,
  isCurrent: () => boolean): Promise<void> {
  try {
    await updateOwnedDraft(id, viewerId, fields);
  } catch (error) {
    if (!isCurrent() || error instanceof DraftUnavailable) throw error;
    const code = (error as {code?: string} | null)?.code;
    if (code && ['42501', 'P0001', '23514', '23503', '22P02'].includes(code)) throw error;
    const columns = [...new Set(['id', 'creator_user_id', 'status', ...Object.keys(fields)])].join(',');
    const result = await requestWithDeadline(supabase.from('events').select(columns)
      .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft').maybeSingle(), 8000);
    if (!isCurrent() || result.error) throw error;
    const row = result.data as Record<string, unknown> | null;
    if (!row || row.id !== id || row.creator_user_id !== viewerId || row.status !== 'draft') throw error;
    const matches = Object.entries(fields).every(([key, expected]) => {
      const actual = row[key];
      if (actual === expected) return true;
      if ((key === 'start_time' || key === 'end_time') && typeof expected === 'string' && typeof actual === 'string') {
        return Number.isFinite(Date.parse(expected)) && compareChatTimestamps(actual, expected) === 0;
      }
      return false;
    });
    if (!matches) throw error;
  }
}

// The same new form keeps its client-generated primary key across retries.
// A conflict can update only a draft that still belongs to this creator.
export async function saveNewPlanDraft(id: string, viewerId: string, fields: Record<string, unknown>, isCurrent: () => boolean) {
  const { data, error } = await supabase.from('events')
    .upsert({ ...fields, id, creator_user_id: viewerId }, { onConflict: 'id', ignoreDuplicates: true })
    .select('id').maybeSingle();
  if (error) throw error;
  if (data?.id === id) return true;
  if (data !== null) throw new Error('Could not confirm the new draft.');
  if (!isCurrent()) return false;
  await updateOwnedDraft(id, viewerId, fields);
  return true;
}

// The database commits the marked plan write and creator membership
// together. Only this attempt's key can confirm a response lost in transit.
export async function publishMemberPlan(id: string, viewerId: string, changes: Record<string, unknown>,
  requestKey: string, source: 'new' | 'draft', isCurrent: () => boolean) {
  const tagged = { ...changes, member_draft_publish_key: requestKey };
  try {
    if (source === 'draft') return await updateOwnedDraft(id, viewerId, tagged);
    const {data, error} = await supabase.from('events').insert({ ...tagged, id, creator_user_id: viewerId }).select('id').single();
    if (error) throw error;
    if (data?.id !== id) throw new Error('Could not confirm the new plan.');
    return { id };
  } catch (error) {
    if (!isCurrent()) throw error;
    const receipt = await requestWithDeadline(supabase.from('events').select('id,member_draft_publish_key')
      .eq('id', id).eq('creator_user_id', viewerId)
      .in('status', ['forming', 'active', 'full']).maybeSingle(), 12_000);
    if (receipt.error) throw receipt.error;
    if (receipt.data?.id === id) {
      if (receipt.data.member_draft_publish_key === requestKey) return { id };
      if (source === 'new') throw new PlanPublishedEarlier();
    }
    throw error;
  }
}
