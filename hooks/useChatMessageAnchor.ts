import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlatList } from 'react-native';
import { parseCommunityMessageAnchor } from '../lib/communityMessageAnchor';

/** A route target is a read window, never part of the composer's room identity. */
export function useChatMessageAnchor(roomId: string | undefined, messageId: unknown, source: unknown) {
  const requested = useMemo(() => parseCommunityMessageAnchor(messageId, source), [messageId, source]);
  const requestKey = `${roomId}:${requested?.source}:${requested?.id}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const anchor = dismissed === requestKey ? null : requested;
  const clearAnchor = useCallback(() => setDismissed(requestKey), [requestKey]);
  return { anchor, clearAnchor, anchorKey: anchor ? `${anchor.source}:${anchor.id}` : null };
}

export function useChatAnchorScroll<T>(list: React.RefObject<FlatList<T> | null>, targetKey: string | null, index: number) {
  const request = useMemo(() => ({ key: targetKey, attempts: 0, done: false, corrected: false, measured: false }), [targetKey]);
  const active = useRef(request); active.current = request;
  const frame = useRef<number | null>(null);
  const jump = useCallback(() => {
    if (active.current !== request || !targetKey || index < 0 || request.done || request.attempts >= 5 || !list.current) return;
    request.attempts++;
    request.done = true;
    list.current.scrollToIndex({ index, animated: false, viewPosition: 0.35 });
    if (request.measured && !request.corrected) {
      request.corrected = true;
      request.done = false;
      frame.current = requestAnimationFrame(jump);
    }
  }, [request, targetKey, index, list]);
  const schedule = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(jump);
  }, [jump]);
  useEffect(() => { schedule(); return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }; }, [schedule]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    if (active.current !== request || !targetKey) return;
    request.done = false;
    list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
    schedule();
  }, [request, targetKey, list, schedule]);
  const onTargetLayout = useCallback(() => {
    if (active.current !== request || request.corrected) return;
    // Virtualized cells can be estimated on the first jump. Correct once after
    // this target actually lays out, then leave subsequent user scrolling alone.
    request.measured = true;
    // A cell may lay out before the first scheduled jump; that first jump
    // still uses estimated sibling metrics. Correct on its following frame.
    if (request.attempts === 0) return;
    request.corrected = true;
    request.done = false;
    request.attempts = 0;
    schedule();
  }, [request, schedule]);
  return { schedule, onScrollToIndexFailed, onTargetLayout };
}
