import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { compareChatTimestamps } from '../lib/chatTimestamp';
import { markTopicRead, type CommunityOperationScope, type TopicMessage } from '../lib/communityChat';

/** A mounted list can stay behind another route or receive data in the background.
 * Keep its visible IDs for a normal return, but retire any outstanding auth check. */
export function useVisibleTopicRead(topicId: string, scope: CommunityOperationScope,
  messages: readonly TopicMessage[], enabled: boolean, unobscured: boolean) {
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const visit = useMemo(() => ({
    ids: new Set<string>(), welcomeId: '', focused: false, generation: 0, pending: '', confirmed: '',
  }), [topicId, scope.userId, scope.isCurrent, enabled]);
  const rendered = useRef({ messages, unobscured });
  rendered.current = { messages, unobscured };
  const acknowledge = useCallback(() => {
    const generation = visit.generation;
    const current = () => enabled && visit.focused && visit.generation === generation
      && AppState.currentState === 'active' && rendered.current.unobscured && scope.isCurrent();
    if (!current() || !scope.userId) return;
    const visible = rendered.current.messages;
    // History is chronological. Only persisted rows reported by this list count.
    let stamp = '';
    for (let i = visible.length - 1; i >= 0; i--) {
      const row = visible[i];
      if (!row.delivery_state && (visit.ids.has(row.id) || row.id === visit.welcomeId)) {
        stamp = row.created_at;
        break;
      }
    }
    if (!stamp || !Number.isFinite(Date.parse(stamp)) || compareChatTimestamps(stamp, visit.confirmed) <= 0 || compareChatTimestamps(stamp, visit.pending) <= 0) return;
    visit.pending = stamp;
    void markTopicRead(topicId, stamp, { userId: scope.userId, isCurrent: current }).then(() => {
      if (!current()) return;
      if (compareChatTimestamps(stamp, visit.confirmed) > 0) visit.confirmed = stamp;
      void queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
    }).catch(() => {}).finally(() => {
      if (visit.generation === generation && visit.pending === stamp) visit.pending = '';
    });
  }, [enabled, scope, topicId, visit, queryClient]);
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
