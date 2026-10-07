import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useObservedUser } from './useObservedUser';
import { supabase } from '../lib/supabase';
import { withDeadline } from '../lib/withTimeout';
import { hapticError } from '../lib/haptics';

type SaveCall = {
  account: string; eventId: string; wasSaved: boolean; wantSaved: boolean; title: string;
  announce: boolean; isCurrent: () => boolean;
};
type Feedback = { call: SaveCall; kind: 'saving' | 'error' };

/** Existing wishlist collection and writes, with account-owned receipts.
 * Saving a plan is independent of membership or invitations. */
export function useFeedWishlist(userId: string | null, onSaved: (eventId: string, title: string) => void) {
  const identity = useObservedUser();
  const queryClient = useQueryClient();
  const visit = useRef<object | null>(null);
  const [renderedVisit, setRenderedVisit] = useState<object | null>(null);
  const pending = useRef(new Map<string, SaveCall>());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [revision, setRevision] = useState(0);
  const lockKey = (account: string, eventId: string) => `${account}:${eventId}`;
  const owner = useMemo(() => ({ userId }), [userId, identity.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  useFocusEffect(useCallback(() => {
    const currentVisit = {}; visit.current = currentVisit; setRenderedVisit(currentVisit);
    return () => { if (visit.current === currentVisit) visit.current = null; };
  }, []));

  const query = useQuery<string[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await withDeadline(
        supabase.from('wishlists').select('event_id').eq('user_id', userId), 8000, 'saved plans',
      );
      if (error) throw error;
      return (data ?? []).map((row: { event_id: string }) => row.event_id);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (call: SaveCall) => {
      if (!call.isCurrent()) throw new Error('Obsolete save');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!call.isCurrent() || user?.id !== call.account) throw new Error('Obsolete save');
      if (error) throw error;
      const result = !call.wantSaved
        ? await supabase.from('wishlists').delete().eq('user_id', call.account).eq('event_id', call.eventId)
        : await supabase.from('wishlists').insert({ user_id: call.account, event_id: call.eventId });
      if (result.error) throw result.error;
    },
    onMutate: async (call: SaveCall) => {
      const key = ['wishlists', call.account];
      await queryClient.cancelQueries({ queryKey: key });
      if (!call.isCurrent()) throw new Error('Obsolete save');
      queryClient.setQueryData<string[]>(key, (old = []) =>
        !call.wantSaved ? old.filter(id => id !== call.eventId) : [...new Set([...old, call.eventId])],
      );
      return { optimistic: true };
    },
    onSuccess: (_result, call) => {
      if (!call.isCurrent()) return;
      setFeedback(old => old?.call === call ? null : old);
      if (call.wantSaved && call.announce) onSavedRef.current(call.eventId, call.title);
    },
    onError: (_error, call, context) => {
      // Restore only this plan. A failed save must not undo another plan's
      // successful optimistic update in the same account's collection.
      if (context?.optimistic) queryClient.setQueryData<string[]>(['wishlists', call.account], (old = []) =>
        call.wasSaved ? [...new Set([...old, call.eventId])] : old.filter(id => id !== call.eventId),
      );
      if (call.isCurrent()) { hapticError(); setFeedback({ call, kind: 'error' }); }
    },
    onSettled: (_result, _error, call) => {
      const key = lockKey(call.account, call.eventId);
      if (pending.current.get(key) === call) pending.current.delete(key);
      if (visit.current && ownerRef.current.userId === call.account) setRevision(value => value + 1);
      // Reconcile the original account, even if its screen has since closed.
      // Invalidation does not turn an unconfirmed response into success.
      // Wait for this account's other writes before replacing their optimistic
      // state with a read. Each final receipt still refreshes the whole set.
      if (![...pending.current.values()].some(other => other.account === call.account)) {
        void queryClient.invalidateQueries({ queryKey: ['wishlists', call.account] });
      }
      void queryClient.invalidateQueries({ queryKey: ['saved-plans'] });
    },
  });

  const canWrite = !!userId && identity.viewerId === userId && identity.isCurrent() && !identity.error && !identity.isLoading && query.isSuccess;
  const toggle = (eventId: string, title: string, announce = true, desired?: boolean) => {
    const currentVisit = renderedVisit;
    if (!currentVisit || visit.current !== currentVisit || ownerRef.current !== owner || !userId || identity.viewerId !== userId || !identity.isCurrent() ||
        identity.error || identity.isLoading || !query.isSuccess || pending.current.has(lockKey(userId, eventId))) return;
    const wasSaved = (queryClient.getQueryData<string[]>(['wishlists', userId]) ?? []).includes(eventId);
    const wantSaved = desired ?? !wasSaved;
    if (wantSaved === wasSaved) { setFeedback(null); return; }
    const call: SaveCall = {
      account: userId, eventId, title, announce,
      wasSaved, wantSaved,
      isCurrent: () => ownerRef.current === owner && visit.current === currentVisit && identity.isCurrent(),
    };
    pending.current.set(lockKey(userId, eventId), call); // synchronous: repeated taps cannot enqueue duplicate writes
    setFeedback({ call, kind: 'saving' });
    mutation.mutate(call);
  };
  const activeFeedback = feedback?.call.isCurrent() ? feedback : null;
  return {
    ...query, toggle, revision, canWrite,
    identityError: identity.error,
    identityLoading: identity.isLoading || identity.viewerId !== userId,
    retryIdentity: identity.retry,
    feedback: activeFeedback,
    pending: (eventId: string) => !!userId && pending.current.has(lockKey(userId, eventId)),
    retry: () => { if (activeFeedback?.kind === 'error') toggle(activeFeedback.call.eventId, activeFeedback.call.title, activeFeedback.call.announce, activeFeedback.call.wantSaved); },
    dismissFeedback: () => setFeedback(null),
  };
}
