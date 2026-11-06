import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export class DraftUnavailable extends Error {}

export async function updateOwnedDraft(id: string, viewerId: string, changes: Record<string, unknown>) {
  const { data, error } = await supabase.from('events').update(changes)
    .eq('id', id).eq('creator_user_id', viewerId).eq('status', 'draft')
    .select('id').maybeSingle();
  if (error) throw error;
  if (data === null) throw new DraftUnavailable();
  if (data?.id !== id) throw new Error('Could not confirm the draft update.');
  return { id };
}

// The same new form keeps its client-generated primary key across retries.
// A conflict can update only a draft that still belongs to this creator.
export async function saveNewPlanDraft(id: string, viewerId: string, fields: Record<string, unknown>, isCurrent: () => boolean) {
  const { data, error } = await supabase.from('events')
    .upsert({ ...fields, id, creator_user_id: viewerId }, { onConflict: 'id', ignoreDuplicates: true })
    .select('id').maybeSingle();
  if (error) throw error;
  if (data?.id === id) return;
  if (data !== null) throw new Error('Could not confirm the new draft.');
  if (isCurrent()) await updateOwnedDraft(id, viewerId, fields);
}

// The database commits the marked draft transition and creator membership
// together. Only this attempt's key can confirm a response lost in transit.
export async function publishOwnedDraft(id: string, viewerId: string, changes: Record<string, unknown>,
  requestKey: string, isCurrent: () => boolean) {
  try {
    return await updateOwnedDraft(id, viewerId, { ...changes, member_draft_publish_key: requestKey });
  } catch (error) {
    if (!isCurrent()) throw error;
    const receipt = await requestWithDeadline(supabase.from('events').select('id,member_draft_publish_key')
      .eq('id', id).eq('creator_user_id', viewerId).eq('member_draft_publish_key', requestKey)
      .in('status', ['forming', 'active', 'full']).maybeSingle(), 12_000);
    if (receipt.error) throw receipt.error;
    if (receipt.data?.id === id && receipt.data.member_draft_publish_key === requestKey) return { id };
    throw error;
  }
}
