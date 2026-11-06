import type { QueryClient } from '@tanstack/react-query';

export type WaitlistEntry = { id: string; event_id: string; user_id: string; notified?: boolean; exception_status?: string | null; exception_invited_at?: string | null; exception_expires_at?: string | null };
type Ticket = { readonly key: string; readonly desired: boolean; readonly rowId: string; conflict: boolean };
type Outcome = { kind: 'pending' | 'unknown' | 'refused' | 'conflict' } | { kind: 'confirmed'; entry: WaitlistEntry | null };
type Listener = (ticket: Ticket, outcome: Outcome) => void;

// A detail route can disappear while the database transaction is still in
// flight. Keep its identity with this app session, independently of the view.
function createStore() {
  const tickets = new Map<string, Ticket>();
  const listeners = new Map<string, Set<Listener>>();
  function notify(ticket: Ticket, outcome: Outcome) {
    listeners.get(ticket.key)?.forEach(listener => listener(ticket, outcome));
  }
  return {
    get: (key: string) => tickets.get(key),
    begin(key: string, desired: boolean, rowId: string) {
      if (tickets.has(key)) return null;
      const ticket = {key,desired,rowId,conflict:false};
      tickets.set(key,ticket);
      notify(ticket,{kind:'pending'});
      return ticket;
    },
    finish(ticket: Ticket, outcome: Outcome) {
      if (tickets.get(ticket.key) !== ticket) return false;
      if (outcome.kind === 'conflict') ticket.conflict = true;
      if (outcome.kind === 'confirmed' || outcome.kind === 'refused') tickets.delete(ticket.key);
      notify(ticket,outcome);
      return true;
    },
    subscribe(key: string, listener: Listener) {
      let set = listeners.get(key);
      if (!set) listeners.set(key,set=new Set());
      set.add(listener);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
  };
}
const stores = new WeakMap<QueryClient, ReturnType<typeof createStore>>();
export function waitlistChangeReceipts(client: QueryClient) {
  let store=stores.get(client);
  if (!store) stores.set(client,store=createStore());
  return store;
}
