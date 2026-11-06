import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export function planChatAccessKey(eventId: string, viewerId: string | null) {
  return ['events', 'members', eventId, 'chat-access', viewerId] as const;
}

export async function readPlanChatMembership(eventId: string, viewerId: string): Promise<boolean> {
  const { data, error } = await supabase.from('event_members').select('event_id,user_id,status')
    .eq('event_id', eventId).eq('user_id', viewerId).maybeSingle();
  if (error) throw error;
  if (data === null) return false;
  if (data?.event_id !== eventId || data.user_id !== viewerId || typeof data.status !== 'string') {
    throw new Error('Plan membership could not be checked.');
  }
  return data.status === 'joined';
}

export function closeDepartedPlanChat(client: QueryClient, eventId: string, viewerId: string) {
  const filters = { queryKey: planChatAccessKey(eventId, viewerId) };
  // A membership read started before Leave must not restore admission.
  void client.cancelQueries(filters);
  client.setQueriesData(filters, false);
}
