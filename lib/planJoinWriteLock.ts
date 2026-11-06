import type { QueryClient } from '@tanstack/react-query';

type Hold = { token: object; checking: boolean };
function createLocks() {
  const active = new Map<string, Hold>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: (key: string) => active.get(key),
    begin(key: string, token: object) {
      if (active.has(key)) return false;
      active.set(key, { token, checking: false }); notify(); return true;
    },
    check(key: string, token: object) {
      const hold = active.get(key);
      if (hold?.token !== token || hold.checking) return;
      active.set(key, { token, checking: true }); notify();
    },
    finish(key: string, token: object) {
      if (active.get(key)?.token !== token) return;
      active.delete(key); notify();
    },
  };
}

// Multiple visits can observe the same outstanding write. Keep only its token,
// never the introduction or a component closure. Nothing is persisted to disk.
const clients = new WeakMap<QueryClient, ReturnType<typeof createLocks>>();
export function planJoinWriteLocks(client: QueryClient) {
  let locks = clients.get(client);
  if (!locks) { locks = createLocks(); clients.set(client, locks); }
  return locks;
}
