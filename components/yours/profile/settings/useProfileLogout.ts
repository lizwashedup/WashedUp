import { useEffect, useState, useSyncExternalStore } from 'react';

// A provider logout can outlive the profile screen that confirmed it.
const pending = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useProfileLogout(userId: string | null | undefined) {
  // Observer epochs are local to a mounted screen. A global sign-out for this
  // account is still pending even if its observer has since been recreated.
  const startedAt = useSyncExternalStore(subscribe, () => userId ? pending.get(userId) : undefined);
  const [slowStart, setSlowStart] = useState<number>();
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setTimeout(() => setSlowStart(startedAt), Math.max(0, startedAt + 10_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [startedAt]);

  const begin = () => {
    if (!userId || pending.has(userId)) return null;
    pending.set(userId, Date.now());
    notify();
    return () => { pending.delete(userId); notify(); };
  };
  return { begin, busy: startedAt !== undefined, slow: startedAt !== undefined && slowStart === startedAt };
}
