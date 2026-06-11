/**
 * useEventCard - resolves a plan referenced by a chat plan-card message
 * (messages.ref_event_id) into the few fields the compact card needs.
 *
 * Direct events read, mirroring app/plan/[id].tsx's fetchPlanDetail (invitees can
 * read a normal plan). A missing row (deleted, or not visible) or a
 * completed/cancelled status means the plan has "wrapped": the card renders quiet
 * and inert rather than broken.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface EventCard {
  id: string;
  title: string;
  start_time: string;
  status: string;
  wrapped: boolean;
}

export function useEventCard(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ['event-card', eventId ?? ''],
    enabled: !!eventId,
    staleTime: 60_000,
    queryFn: async (): Promise<EventCard | null> => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_time, status')
        .eq('id', eventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null; // deleted / not visible -> wrapped
      return {
        id: data.id,
        title: data.title,
        start_time: data.start_time,
        status: data.status,
        wrapped: data.status === 'completed' || data.status === 'cancelled',
      };
    },
  });
}
