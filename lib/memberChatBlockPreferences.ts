import { supabase } from './supabase';

// Older profile rows can explicitly store null. An absent profile or an
// incomplete response cannot authorize displaying other members' text.
export async function readMemberChatBlockPreferences(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('profiles').select('blocked_users').eq('id', userId).maybeSingle();
  if (error) throw error;
  const ids = data?.blocked_users;
  if (!data || (ids !== null && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && id.length > 0)))) {
    throw new Error('Could not verify chat privacy settings.');
  }
  return new Set(ids ?? []);
}
