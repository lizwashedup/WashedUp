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
