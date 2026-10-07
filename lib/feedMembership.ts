import { supabase } from './supabase';

/** Confirm joined/created plans, excluding explicit departures from either set. */
export async function readFeedMemberIds(userId: string): Promise<string[]> {
  const [joined, created, left] = await Promise.all([
    supabase.from('event_members').select('event_id').eq('user_id', userId).eq('status', 'joined'),
    supabase.from('events').select('id').eq('creator_user_id', userId),
    supabase.from('event_members').select('event_id').eq('user_id', userId).eq('status', 'left'),
  ]);
  // A failed exclusion read cannot establish that the creator is still going.
  for (const result of [joined, created, left]) if (result.error) throw result.error;
  const departed = new Set((left.data ?? []).map(row => row.event_id));
  return [...new Set([
    ...(joined.data ?? []).map(row => row.event_id),
    ...(created.data ?? []).map(row => row.id),
  ])].filter(id => typeof id === 'string' && !!id && !departed.has(id));
}
