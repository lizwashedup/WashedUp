import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { compareChatTimestamps } from '../lib/chatTimestamp';
import { markTopicRead, markBroadcastsRead, type CommunityOperationScope } from '../lib/communityChat';

/** A mounted list can stay behind another route or receive data in the background.
 * Keep its visible IDs for a normal return, but retire any outstanding auth check. */
export function useVisibleCommunityRead(kind: 'main' | 'topic', roomId: string, scope: CommunityOperationScope,
  messages: readonly { id: string; created_at: string; delivery_state?: unknown }[], enabled: boolean, unobscured: boolean) {
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const visit = useMemo(() => ({
    ids: new Set<string>(), welcomeId: '', focused: false, generation: 0, pending: '', confirmed: '',
  }), [kind, roomId, scope.userId, scope.isCurrent, enabled]);
  const rendered = useRef({ messages, unobscured });
  rendered.current = { messages, unobscured };
  const acknowledge = useCallback(() => {
    const generation = visit.generation;
    const current = () => enabled && visit.focused && visit.generation === generation
      && AppState.currentState === 'active' && rendered.current.unobscured && scope.isCurrent();
    if (!current() || !scope.userId) return;
    const visible = rendered.current.messages;
    // Topic history is oldest-first; Main is newest-first. Compare server
    // timestamps, including microseconds, independently of display order.
    let stamp = '';
    for (const row of visible) {
      if (!row.delivery_state && (visit.ids.has(row.id) || row.id === visit.welcomeId)
        && compareChatTimestamps(row.created_at, stamp) > 0) stamp = row.created_at;
    }
    if (!stamp || !Number.isFinite(Date.parse(stamp)) || compareChatTimestamps(stamp, visit.confirmed) <= 0 || compareChatTimestamps(stamp, visit.pending) <= 0) return;
    visit.pending = stamp;
    const write = kind === 'topic' ? markTopicRead : markBroadcastsRead;
    void write(roomId, stamp, { userId: scope.userId, isCurrent: current }).then(() => {
      if (!current()) return;
      if (compareChatTimestamps(stamp, visit.confirmed) > 0) visit.confirmed = stamp;
      void queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
    }).catch(() => {}).finally(() => {
      if (visit.generation === generation && visit.pending === stamp) visit.pending = '';
    });
  }, [enabled, scope, kind, roomId, visit, queryClient]);
  useLayoutEffect(() => {
    visit.focused = focused;
    acknowledge();
    return () => { visit.focused = false; visit.generation++; visit.pending = ''; };
  }, [acknowledge, visit, focused]);
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') acknowledge();
      else { visit.generation++; visit.pending = ''; }
    });
    return () => sub.remove();
  }, [acknowledge, enabled, visit]);
  useEffect(() => {
    if (unobscured) acknowledge();
    else { visit.generation++; visit.pending = ''; }
  }, [acknowledge, unobscured, visit]);
  const rowsVisible = useCallback((ids: string[]) => {
    visit.ids = new Set(ids);
    acknowledge();
  }, [acknowledge, visit]);
  const welcomeVisible = (id: string) => { visit.welcomeId = id; acknowledge(); };
  return { rowsVisible, welcomeVisible };
}
