import type { QueryClient } from '@tanstack/react-query';

type Result = 'saved' | 'refused' | 'unknown';
type Ticket = { key: string };
type Listener = (result: Result) => void;

function createReceipts() {
  const outstanding = new Map<string, Ticket>();
  const observers = new Map<string, Set<Listener>>();
  return {
    get: (key: string) => outstanding.get(key),
    begin(key: string) {
      if (outstanding.has(key)) return null;
      const ticket = { key };
      outstanding.set(key, ticket);
      return ticket;
    },
    settle(ticket: Ticket, result: Result) {
      if (outstanding.get(ticket.key) !== ticket) return;
      if (result !== 'unknown') outstanding.delete(ticket.key);
      observers.get(ticket.key)?.forEach(notify => notify(result));
    },
    observed(ticket: Ticket) {
      if (outstanding.get(ticket.key) === ticket) outstanding.delete(ticket.key);
    },
    subscribe(key: string, listener: Listener) {
      let group = observers.get(key);
      if (!group) observers.set(key, group = new Set());
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) observers.delete(key);
      };
    },
  };
}

// Keep the pending intent across detail routes, not the view or the member's profile.
// A missing row while a prior transaction is invisible cannot authorize another send.
const clients = new WeakMap<QueryClient, ReturnType<typeof createReceipts>>();
export function planInterestReceipts(client: QueryClient) {
  let store = clients.get(client);
  if (!store) clients.set(client, store = createReceipts());
  return store;
}
