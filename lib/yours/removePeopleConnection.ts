import { requestWithDeadline } from '../requestWithDeadline';
import { supabase } from '../supabase';

async function readConnection(viewer: string, target: string) {
  // Both directions are in the same snapshot. An older removed row can
  // coexist with a newer accepted relationship in the opposite direction.
  const pair = [viewer, target];
  const { data, error } = await requestWithDeadline(supabase.from('people_connections')
    .select('requester_user_id,recipient_user_id,status,can_re_request')
    .in('requester_user_id', pair).in('recipient_user_id', pair), 8000);
  if (error) throw error;
  if (!Array.isArray(data)) return 'unknown';
  if (data.some(row => row.status === 'accepted' && (
    (row.requester_user_id === viewer && row.recipient_user_id === target) ||
    (row.requester_user_id === target && row.recipient_user_id === viewer)
  ))) return 'connected';
  // remove_connection always leaves this directional marker within its transaction.
  return data.some(row => row.requester_user_id === target && row.recipient_user_id === viewer
    && row.status === 'removed' && row.can_re_request === false) ? 'removed' : 'unknown';
}

export async function removePeopleConnection(target: string, viewer: string, checks: { current(): void; dispatch(): void }) {
  const before = await readConnection(viewer, target);
  checks.current();
  if (before === 'removed') return;
  if (before !== 'connected') throw new Error('Could not confirm this connection.');
  checks.dispatch();
  try {
    const { error } = await requestWithDeadline(supabase.rpc('remove_connection', { p_other: target }), 12000);
    if (error) throw error;
  } catch (error) {
    checks.current();
    const after = await readConnection(viewer, target);
    checks.current();
    if (after !== 'removed') throw error;
  }
}
