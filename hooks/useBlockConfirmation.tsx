import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandedAlert } from '../components/BrandedAlert';
import { supabase } from '../lib/supabase';

/**
 * BrandedAlert-driven confirmation flow for blocking a user.
 *
 * Returns:
 * - `requestBlock(id, name, options)` — opens the upfront confirm modal.
 *   On success, fires `options.onSuccess` and (if provided) shows a soft
 *   "want to tell us what happened?" prompt that calls
 *   `options.onRequestReport` if the user opts in.
 * - `blockNow(id, name, onSuccess?)` — runs the mutation directly without
 *   the confirm modal; for follow-up flows (e.g. the "also block?"
 *   prompt that fires after a standalone report) where consent has
 *   already been collected.
 * - `modals` — render this fragment somewhere in the consumer's tree.
 *
 * Apple 1.2: every block writes a silent compliance row to `reports`
 * regardless of whether the user opts into the post-block prompt.
 */
type RequestBlockOptions = {
  onSuccess?: () => void;
  onRequestReport?: (blockedId: string, blockedName: string) => void;
};

export function useBlockConfirmation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [confirmTarget, setConfirmTarget] = useState<{
    blockedId: string;
    blockedName: string;
    options: RequestBlockOptions;
  } | null>(null);
  const [postBlockPrompt, setPostBlockPrompt] = useState<{
    blockedId: string;
    blockedName: string;
    onRequestReport: NonNullable<RequestBlockOptions['onRequestReport']>;
  } | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const requestBlock = useCallback(
    (
      blockedId: string,
      blockedName: string,
      options?: RequestBlockOptions,
    ) => {
      setConfirmTarget({ blockedId, blockedName, options: options ?? {} });
    },
    [],
  );

  const runBlockMutation = useCallback(
    async (blockedId: string, blockedName: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('blocked_users')
        .eq('id', user.id)
        .single();

      const current: string[] = profile?.blocked_users ?? [];
      if (!current.includes(blockedId)) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ blocked_users: [...current, blockedId] })
          .eq('id', user.id);
        if (updateError) throw updateError;

        // Apple 1.2: silent compliance report fires on EVERY block.
        try {
          await supabase.from('reports').insert({
            reporter_user_id: user.id,
            reported_user_id: blockedId,
            reason: 'Blocked by user',
            reported_event_id: null,
            details: `User blocked ${blockedName}. They will no longer appear in their feed or be able to contact them.`,
          });
        } catch {
          // best-effort; block still succeeds
        }
      }

      // Mirror useBlock's invalidations — instant feed removal.
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['events', 'members'] });
      queryClient.invalidateQueries({ queryKey: ['event-plans'] });
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['profile-blocked'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['profile-search'] });
      queryClient.invalidateQueries({ queryKey: ['scene-events'] });
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['wishlists'] });
    },
    [queryClient],
  );

  const handleBlock = useCallback(
    async () => {
      if (!confirmTarget || working) return;
      const { blockedId, blockedName, options } = confirmTarget;
      setWorking(true);
      try {
        await runBlockMutation(blockedId, blockedName);
        options.onSuccess?.();
        setConfirmTarget(null);
        // Soft post-block prompt: ask if they want to tell us why.
        // Higher signal than the upfront commitment because the user
        // is more honest after the action than before it.
        if (options.onRequestReport) {
          setTimeout(() => {
            setPostBlockPrompt({
              blockedId,
              blockedName,
              onRequestReport: options.onRequestReport!,
            });
          }, 250);
        }
      } catch {
        setConfirmTarget(null);
        setTimeout(() => setErrorOpen(true), 250);
      } finally {
        setWorking(false);
      }
    },
    [confirmTarget, working, runBlockMutation],
  );

  /**
   * Run the block mutation directly without showing the confirm modal.
   * Use this when the user has already consented in another flow (e.g.
   * the post-report "also block?" prompt). Errors surface in the same
   * error modal as `requestBlock`.
   */
  const blockNow = useCallback(
    async (
      blockedId: string,
      blockedName: string,
      onSuccess?: () => void,
    ) => {
      if (working) return;
      setWorking(true);
      try {
        await runBlockMutation(blockedId, blockedName);
        onSuccess?.();
      } catch {
        setTimeout(() => setErrorOpen(true), 250);
      } finally {
        setWorking(false);
      }
    },
    [working, runBlockMutation],
  );

  const blockingMessage = `blocking means:
• you won't see their plans
• they won't see your plans
• if they join a plan first, you won't see it
• if you join a plan first, they won't see it`;

  const modals = (
    <>
      <BrandedAlert
        visible={!!confirmTarget}
        title={confirmTarget ? `block ${confirmTarget.blockedName}?` : ''}
        message={confirmTarget ? blockingMessage : undefined}
        buttons={[
          { text: 'block', style: 'destructive', onPress: () => { void handleBlock(); } },
          { text: 'cancel', style: 'cancel' },
        ]}
        footerLink={{
          text: 'see your blocked users',
          onPress: () => router.push('/profile/blocked-users'),
        }}
        onClose={() => {
          if (!working) setConfirmTarget(null);
        }}
      />

      <BrandedAlert
        visible={!!postBlockPrompt}
        title={
          postBlockPrompt
            ? `${postBlockPrompt.blockedName} is blocked`
            : ''
        }
        message="want to tell us what happened? it helps us catch patterns."
        buttons={[
          { text: 'no thanks', style: 'cancel' },
          {
            text: 'report',
            onPress: () => {
              if (postBlockPrompt) {
                postBlockPrompt.onRequestReport(
                  postBlockPrompt.blockedId,
                  postBlockPrompt.blockedName,
                );
              }
            },
          },
        ]}
        onClose={() => setPostBlockPrompt(null)}
      />

      <BrandedAlert
        visible={errorOpen}
        title="something went wrong"
        message="could not block user. please try again."
        buttons={[{ text: 'ok' }]}
        onClose={() => setErrorOpen(false)}
      />
    </>
  );

  return { requestBlock, blockNow, modals };
}
