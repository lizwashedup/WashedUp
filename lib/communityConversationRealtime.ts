import { subscribeChatWhenReady } from './chatRealtimeSubscription';
import { supabase } from './supabase';

let nextSubscription = 0;

function subscribeWhenReady(channel: ReturnType<typeof supabase.channel>, current: () => boolean) {
  return subscribeChatWhenReady(() => supabase.realtime.isDisconnecting(), () => { channel.subscribe(); }, current);
}

type Refresh = {
  channelName: string;
  isCurrent: () => boolean;
  refresh: () => Promise<unknown> | void;
};

/** Keep one read in flight, with one catch-up read for changes received during it. */
function refreshQueue(options: Refresh) {
  let active = true, running = false, queued = false;
  const current = () => active && options.isCurrent();
  const refresh = () => {
    if (!current()) return;
    queued = true;
    if (running) return;
    running = true;
    void Promise.resolve().then(async () => {
      try {
        while (queued && current()) {
          queued = false;
          // The existing query owns its visible error and explicit retry state.
          try { await options.refresh(); } catch { /* retain current history */ }
        }
      } finally { running = false; }
    });
  };
  return { current, refresh, retire: () => { active = false; queued = false; } };
}

export function subscribeCommunityMain(options: Refresh & {
  communityId: string;
  hasMessage: (id: string) => boolean;
  hasMessages: () => boolean;
  onMessage: () => void;
}) {
  const queue = refreshQueue(options);
  // A quick return must not reuse a channel whose asynchronous leave is pending.
  const channel = supabase.channel(`${options.channelName}-${++nextSubscription}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcasts', filter: `community_id=eq.${options.communityId}` }, () => {
      if (!queue.current()) return;
      queue.refresh(); options.onMessage();
    })
    // Deleted records only carry their primary key. A community_id filter
    // cannot deliver these; only refresh for a message already in this room.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'community_broadcasts' }, payload => {
      if (options.hasMessage(payload.old.id)) queue.refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcast_reactions' }, payload => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (options.hasMessage(row.broadcast_id)) queue.refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcast_replies' }, payload => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      // Reply DELETE has only an id, so refresh counts through the existing
      // RLS-protected history query. Never copy unscoped payloads into the UI.
      if (options.hasMessage(row.broadcast_id) || (payload.eventType === 'DELETE' && options.hasMessages())) queue.refresh();
    })
    .on('system', {}, payload => {
      // SUBSCRIBED precedes PostgreSQL readiness. Catch up at actual readiness,
      // including reconnects, so no writes can fall into the registration gap.
      if (payload.status === 'ok' && payload.extension === 'postgres_changes') queue.refresh();
    });
  const stopWaiting = subscribeWhenReady(channel, queue.current);
  return () => { queue.retire(); stopWaiting(); void supabase.removeChannel(channel); };
}

export function subscribeCommunityReplies(options: Refresh & {
  broadcastId: string;
  hasReply: (id: string) => boolean;
}) {
  const queue = refreshQueue(options);
  const channel = supabase.channel(`${options.channelName}-${++nextSubscription}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcast_replies', filter: `broadcast_id=eq.${options.broadcastId}` }, () => queue.refresh())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'community_broadcast_replies' }, payload => {
      if (options.hasReply(payload.old.id)) queue.refresh();
    })
    .on('system', {}, payload => {
      if (payload.status === 'ok' && payload.extension === 'postgres_changes') queue.refresh();
    });
  const stopWaiting = subscribeWhenReady(channel, queue.current);
  return () => { queue.retire(); stopWaiting(); void supabase.removeChannel(channel); };
}
