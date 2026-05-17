import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { INBOX_COUNT_KEY } from '../constants/QueryKeys';
import type { ConnectionContext } from '../lib/yours/types';

/** Map a raised Postgres exception to a warm, user-facing message. */
export function friendlyConnectionError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? '';
  if (msg.includes('cannot_re_request')) {
    return "They're not taking requests right now.";
  }
  if (msg.includes('already_connected')) {
    return "You're already people.";
  }
  if (msg.includes('blocked')) {
    return "You can't add this person.";
  }
  if (msg.includes('no_pending_request')) {
    return 'That request is no longer here.';
  }
  return 'Something went sideways. Try again in a sec.';
}

/**
 * All people-connection writes. Each invalidates the grid, backlog,
 * requests, and the inbox badge so the UI reflects the new state.
 */
export function usePeopleConnectionMutations(
  userId: string | null | undefined,
) {
  const qc = useQueryClient();

  const invalidate = () => {
    if (!userId) return;
    qc.invalidateQueries({ queryKey: yoursKeys.grid(userId) });
    qc.invalidateQueries({ queryKey: yoursKeys.backlog(userId) });
    qc.invalidateQueries({ queryKey: yoursKeys.requests(userId) });
    qc.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
  };

  const sendRequest = useMutation({
    mutationFn: async (args: {
      recipientId: string;
      context: ConnectionContext;
      contextEventId?: string | null;
    }) => {
      const { error } = await supabase.rpc('send_people_request', {
        p_recipient: args.recipientId,
        p_context: args.context,
        p_context_event_id: args.contextEventId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const accept = useMutation({
    mutationFn: async (requesterId: string) => {
      const { error } = await supabase.rpc('accept_people_request', {
        p_requester: requesterId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const decline = useMutation({
    mutationFn: async (args: { requesterId: string; block?: boolean }) => {
      const { error } = await supabase.rpc('decline_people_request', {
        p_requester: args.requesterId,
        p_block: args.block ?? false,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (otherId: string) => {
      const { error } = await supabase.rpc('remove_connection', {
        p_other: otherId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setVisibility = useMutation({
    mutationFn: async (args: {
      global?: boolean | null;
      personId?: string | null;
      hidden?: boolean | null;
    }) => {
      const { error } = await supabase.rpc('set_plan_visibility', {
        p_global: args.global ?? null,
        p_person: args.personId ?? null,
        p_hidden: args.hidden ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const ping = useMutation({
    mutationFn: async (args: { recipientId: string; eventId: string }) => {
      const { error } = await supabase.rpc('ping_person', {
        p_recipient: args.recipientId,
        p_event_id: args.eventId,
      });
      if (error) throw error;
    },
  });

  return { sendRequest, accept, decline, remove, setVisibility, ping };
}
