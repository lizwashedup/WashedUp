import { compareChatTimestamps } from './chatTimestamp';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export class DraftUnavailable extends Error {}
export class DraftChanged extends Error {}
export class PlanPublishedEarlier extends Error {}

// An absent version supports older handoffs. An explicit null is itself a
// version for older rows. Let PostgreSQL compare timestamptz at full precision.
type DraftVersion = string | null | undefined;
function hasDifferentVersion(value: unknown, version: DraftVersion) {
  if (version === undefined || value === undefined) return false;
  if (value === null || version === null) return value !== version;
  return typeof value === 'string' && compareChatTimestamps(value, version) !== 0;
}
export async function updateOwnedDraft(id: string, viewerId: string, changes: Record<string, unknown>, version?: DraftVersion) {
  let update = supabase.from('events').update(changes)
    .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft');
  if (version === null) update = update.is('updated_at', null);
  else if (version !== undefined) update = update.eq('updated_at', version);
  const {data, error} = version === undefined
    ? await update.select('id').maybeSingle()
    : await update.select('id,updated_at').maybeSingle();
  if (error) throw error;
  if (data === null) throw new DraftUnavailable();
  const savedVersion = data && 'updated_at' in data ? data.updated_at : undefined;
  if (data?.id !== id || (version !== undefined && typeof savedVersion !== 'string')) {
    throw new Error('Could not confirm the draft update.');
  }
  return {id, version: typeof savedVersion === 'string' ? savedVersion : undefined};
}

/** A lost response is ambiguous. Confirm the intended field values on the
 * same owned draft without submitting the edit again. Publishing has a
 * separate receipt that checks its request key and resulting status. */
export async function saveExistingPlanDraft(id: string, viewerId: string, fields: Record<string, unknown>,
  isCurrent: () => boolean, version?: DraftVersion): Promise<DraftVersion> {
  try {
    return (await updateOwnedDraft(id, viewerId, fields, version)).version;
  } catch (error) {
    if (!isCurrent() || (error instanceof DraftUnavailable && version === undefined)) throw error;
    const code = (error as {code?: string} | null)?.code;
    if (code && ['42501', 'P0001', '23514', '23503', '22P02'].includes(code)) throw error;
    const columns = [...new Set(['id', 'creator_user_id', 'status', ...(version === undefined ? [] : ['updated_at']), ...Object.keys(fields)])].join(',');
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
    if (!matches) {
      if (hasDifferentVersion(row.updated_at, version)) throw new DraftChanged();
      throw error;
    }
    if (version !== undefined && typeof row.updated_at !== 'string') throw error;
    return row.updated_at as DraftVersion;
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
  requestKey: string, source: 'new' | 'draft', isCurrent: () => boolean, version?: DraftVersion) {
  const tagged = { ...changes, member_draft_publish_key: requestKey };
  try {
    if (source === 'draft') return await updateOwnedDraft(id, viewerId, tagged, version);
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
    if (source === 'draft' && version !== undefined && error instanceof DraftUnavailable && isCurrent()) {
      const latest = await requestWithDeadline(supabase.from('events').select('id,updated_at')
        .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft').maybeSingle(), 8000);
      if (latest.error) throw latest.error;
      if (isCurrent() && latest.data?.id === id && hasDifferentVersion(latest.data.updated_at, version)) throw new DraftChanged();
    }
    throw error;
  }
}
