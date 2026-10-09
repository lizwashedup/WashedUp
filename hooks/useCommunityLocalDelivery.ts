import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommunityBroadcast, CommunityOperationScope } from '../lib/communityChat';
import type { TopicDraftAttempt } from '../lib/topicComposerDraft';

export type CommunityDeliveryRow = CommunityBroadcast & { localDelivery?: 'sending' | 'unconfirmed' | 'sent' };
/** Local presentation only. Durable originals and transport remain owned by the
 * composer. A server row replaces its local copy by UUID, never by text. */
export function useCommunityLocalDelivery(
  scope: CommunityOperationScope, messages: CommunityBroadcast[], attempt: TopicDraftAttempt | null, sending: boolean,
) {
  const active = useRef(scope); active.current = scope;
  const [saved, setSaved] = useState<{ scope: CommunityOperationScope; rows: CommunityDeliveryRow[] }>({ scope, rows: [] });
  const pending = useMemo<CommunityDeliveryRow | null>(() => attempt?.kind === 'send' ? {
    id: attempt.id, body: attempt.text, mention_data: attempt.mentions, created_at: new Date().toISOString(),
    sender_id: scope.userId, sender_name: null, sender_photo: null, kind: 'message', payload: null,
    image_url: null, edited_at: null, reactions: [], reply_count: 0,
  } : null, [scope, attempt?.id]);
  useEffect(() => {
    setSaved(previous => {
      if (previous.scope !== scope) return { scope, rows: [] };
      if (previous.rows.length === 0) return previous;
      const ids = new Set(messages.map(message => message.id));
      const remaining = previous.rows.filter(row => !ids.has(row.id));
      return remaining.length === previous.rows.length ? previous : { scope, rows: remaining };
    });
  }, [scope, messages]);
  const confirm = useCallback((original: TopicDraftAttempt) => {
    if (original.kind !== 'send' || active.current !== scope || !scope.isCurrent()) return;
    setSaved(previous => ({ scope, rows: [
      { id: original.id, body: original.text, mention_data: original.mentions,
        created_at: pending?.id === original.id ? pending.created_at : new Date().toISOString(),
        sender_id: scope.userId, sender_name: null, sender_photo: null, kind: 'message', payload: null,
        image_url: null, edited_at: null, reactions: [], reply_count: 0, localDelivery: 'sent' },
      ...(previous.scope === scope ? previous.rows.filter(row => row.id !== original.id) : []),
    ] }));
  }, [scope, pending]);
  // Composer/keyboard renders must not rebuild an unchanged history. Depend on
  // the full server array, not just IDs: edits and reactions keep their IDs.
  const combined = useMemo<CommunityDeliveryRow[]>(() => {
    const local = saved.scope === scope ? [...saved.rows] : [];
    if (pending && !local.some(row => row.id === pending.id)) local.unshift({ ...pending, localDelivery: sending ? 'sending' : 'unconfirmed' });
    if (local.length === 0) return messages;
    const serverIds = new Set(messages.map(message => message.id));
    const additions = local.filter(row => !serverIds.has(row.id));
    return additions.length === 0 ? messages : [...additions, ...messages];
  }, [scope, saved, pending, sending, messages]);
  return { messages: combined, confirm };
}
