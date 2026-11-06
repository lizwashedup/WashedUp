import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { INBOX_COUNT_KEY } from '../constants/QueryKeys';
import { hapticLight } from '../lib/haptics';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { supabase } from '../lib/supabase';

type CountResult = { count: number | null; error: { code: string } | null };
type Phase = 'idle' | 'clearing' | 'retry' | 'unknown' | 'checking';
type Notice = { id: string; created_at: string };
type Scope = { userId: string | null; epoch: number; isCurrent: () => boolean };
type Attempt = { cutoff: string; visibleIds: Set<string> };
const rejected = new Set(['42501', '28000', '28P01', '23514', '40001', '40P01', 'P0001']);

export function useClearInboxNotifications(scope: Scope, visit: object, isOpen: () => boolean, selection: 'all' | { id: string }) {
  const single = selection !== 'all';
  const notificationId = single ? selection.id : undefined;
  const client = useQueryClient();
  const state = useMemo(() => ({ phase: 'idle' as Phase, attempt: null as Attempt | null }), [visit, scope.epoch, scope.userId, single, notificationId]);
  const owner = useRef<typeof state | null>(null);
  const [, render] = useState(0);
  useLayoutEffect(() => {
    owner.current = state;
    return () => { owner.current = null; };
  }, [state]);
  const current = () => owner.current === state && scope.isCurrent() && isOpen();
  const change = (phase: Phase) => {
    state.phase = phase;
    if (current()) render(value => value + 1);
  };

  const press = async (notices: readonly Notice[]) => {
    const userId = scope.userId;
    if (!userId || !current() || state.phase === 'clearing' || state.phase === 'checking') return;
    if (single && (!notificationId || notices.length !== 1 || notices[0].id !== notificationId)) return;
    if (!state.attempt) {
      // The list is newest-first. Keep the original cutoff through retries,
      // including older pages, while preserving notifications that arrive later.
      const cutoff = notices[0]?.created_at;
      if (!cutoff || !Number.isFinite(Date.parse(cutoff))) return;
      state.attempt = { cutoff, visibleIds: new Set(notices.map(row => row.id)) };
    }
    const attempt = state.attempt;
    const checking = state.phase === 'unknown';
    change(checking ? 'checking' : 'clearing');
    hapticLight();
    try {
      const table = supabase.from('app_notifications');
      const query = checking
        ? table.select('id', { count: 'exact', head: true })
        : table.update({ status: 'read' }, { count: 'exact' });
      const eligible = query.eq('user_id', userId).eq('status', 'unread')
        .neq('type', 'plan_invite').neq('type', 'new_message')
        .lte('created_at', attempt.cutoff).or('expires_at.is.null,expires_at.gt.now()');
      const target = notificationId ? eligible.eq('id', notificationId) : eligible;
      const response = await requestWithDeadline<CountResult>(target, 12_000);
      if (response.error) {
        change(!checking && rejected.has(response.error.code) ? 'retry' : 'unknown');
        return;
      }
      if (typeof response.count !== 'number' || !Number.isSafeInteger(response.count) || response.count < 0) {
        change('unknown');
        return;
      }
      if (checking && response.count > 0) { change('retry'); return; }
      if (!checking && response.count < attempt.visibleIds.size) { change('unknown'); return; }
      // The write can finish after the sheet closes. Refresh only its owner's
      // list and bell, without changing a later visit's feedback.
      const listKey = ['app-notifications', userId, scope.epoch];
      client.setQueryData<Notice[]>(listKey, rows => rows?.filter(row => !attempt.visibleIds.has(row.id)));
      for (const queryKey of [listKey, [...INBOX_COUNT_KEY, userId]]) {
        void client.invalidateQueries({ queryKey }).catch(() => {});
      }
      state.attempt = null;
      change('idle');
    } catch {
      change('unknown');
    }
  };
  return { phase: state.phase, press };
}
