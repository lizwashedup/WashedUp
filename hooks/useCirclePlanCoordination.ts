import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { CirclePlanContext } from './useCirclePlanContext';
import { supabase } from '../lib/supabase';
import { readCircleRequest } from '../lib/circles/readCircleRequest';

type Options = { eventId: string; viewerId: string | null; epoch: number; canStart: boolean; canOpen: boolean;
  isCurrent: () => boolean; refetch: () => Promise<{data?: CirclePlanContext; isSuccess: boolean}> };

// The parent owns this action: refreshing Circle context temporarily unmounts
// the coordination row. Never choose a conversation from the old context.
export function useCirclePlanCoordination(options: Options) {
  const cache = useQueryClient();
  const visit = useRef<object | null>(null);
  const attempt = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<{action: 'start' | 'open'; message: string} | null>(null);
  useFocusEffect(useCallback(() => {
    visit.current = {}; setIssue(null);
    return () => { visit.current = null; };
  }, []));
  const latest = useRef(options); latest.current = options;
  const perform = async (action: 'start' | 'open') => {
    const eligible = () => action === 'start' ? latest.current.canStart : latest.current.canOpen;
    const setError = (message: string) => setIssue({action, message});
    const owner = visit.current;
    const {eventId, viewerId, epoch, isCurrent} = options;
    const current = () => !!owner && visit.current === owner && isCurrent() && latest.current.eventId === eventId && latest.current.viewerId === viewerId && latest.current.epoch === epoch;
    if (!current() || !viewerId || !eligible() || attempt.current) return;
    const token = {}; attempt.current = token; setBusy(true); setIssue(null);
    const key = ['circle-plan-context', eventId, viewerId, epoch];
    try {
      const { data, error: authError } = await readCircleRequest(supabase.auth.getSession());
      if (!current() || !eligible()) return;
      if (authError || !data.session?.access_token || data.session.user.id !== viewerId) throw Error('Check your account and try again.');
      // This void RPC is idempotent. Even a transport error may have committed.
      // Read the original plan's context before offering any conversation.
      try {
        const request = action === 'start' ? supabase.rpc('spawn_plan_chat', {p_event_id: eventId})
          : supabase.rpc('release_circle_plan', {p_event_id: eventId, p_stranger_cap: 4});
        await request.setHeader('Authorization', 'Bearer ' + data.session.access_token);
      } catch { /* A thrown transport error also requires a status read. */ }
      if (!current()) {
        // Another visit may already be showing this plan.
        void cache.invalidateQueries({queryKey: key});
        return;
      }
      const result = await latest.current.refetch();
      if (!current() || !result.isSuccess) return; // The detail screen owns read Retry.
      if (action === 'open' && result.data?.circle_visibility !== 'open') {
        setError('This plan is still just for your circle. You can choose to open it up again.');
        return;
      }
      if (action === 'start' && result.data?.has_own_chat !== true) {
        setError('This plan still uses the circle chat. You can try starting a separate chat again.');
        return;
      }
      void cache.invalidateQueries({queryKey: ['events', 'detail', eventId]});
      void cache.invalidateQueries({queryKey: ['events', 'feed']});
    } catch {
      if (current()) setError('Couldn’t confirm the change. Check the plan details before trying again.');
    } finally {
      if (attempt.current === token) { attempt.current = null; if (isCurrent()) setBusy(false); }
    }
  };
  return { start: () => perform('start'), open: () => perform('open'), busy,
    error: issue && (issue.action === 'open' ? options.canOpen : options.canStart) ? issue.message : '' };
}
