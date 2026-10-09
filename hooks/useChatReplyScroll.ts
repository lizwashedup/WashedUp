import { useCallback, useLayoutEffect, useRef } from 'react';
import type { FlatList } from 'react-native';

type Request = { id: string; scope: unknown; attempts: number; index: number };

/** A bounded, cancellable jump that re-finds the message after arrivals/deletes. */
export function useChatReplyScroll<T>(list: React.RefObject<FlatList<T> | null>, scope: unknown, findIndex: (id: string) => number) {
  const current = useRef({ scope, findIndex }); current.current = { scope, findIndex };
  const request = useRef<Request | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    request.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, [scope, cancel]);
  const jump = useCallback((attempt: Request) => {
    if (!mounted.current || request.current !== attempt || current.current.scope !== attempt.scope || attempt.attempts >= 4) return;
    const index = current.current.findIndex(attempt.id);
    if (index < 0 || !list.current) { cancel(); return; }
    attempt.index = index; attempt.attempts++;
    list.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
  }, [list, cancel]);
  const scrollToMessage = useCallback((id: string) => {
    cancel();
    const attempt = { id, scope: current.current.scope, attempts: 0, index: -1 };
    request.current = attempt;
    jump(attempt);
  }, [cancel, jump]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    const attempt = request.current;
    if (!mounted.current || !attempt || attempt.scope !== current.current.scope || attempt.index !== info.index || attempt.attempts >= 4) return;
    if (timer.current !== null) return;
    list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
    timer.current = setTimeout(() => { timer.current = null; jump(attempt); }, 300);
  }, [jump, list]);
  return { scrollToMessage, onScrollToIndexFailed, cancel };
}
