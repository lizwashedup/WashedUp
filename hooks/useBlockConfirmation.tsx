import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandedAlert } from '../components/BrandedAlert';
import { supabase } from '../lib/supabase';

/**
 * BrandedAlert-driven confirmation flow for blocking a user.
 *
 * Stage 1: this hook owns the confirm + error modals AND inlines the
 * supabase mutation. The live `useBlock` shows its own raw `Alert.alert`,
 * which would double-prompt over our BrandedAlert, so we can't call it
 * here yet. Stage 3 refactors `useBlock` into a pure mutation and this
 * hook switches to calling it; the inlined supabase block below goes
 * away then.
 *
 * No call sites use this hook yet.
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

  const handleBlock = useCallback(
    async (alsoReport: boolean) => {
      if (!confirmTarget || working) return;
      const { blockedId, blockedName, options } = confirmTarget;
      setWorking(true);
      try {
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

          // Apple 1.2: silent compliance report fires on EVERY block,
          // regardless of which destructive button the user picked.
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

        options.onSuccess?.();
        if (alsoReport && options.onRequestReport) {
          options.onRequestReport(blockedId, blockedName);
        }
        setConfirmTarget(null);
      } catch {
        setConfirmTarget(null);
        setTimeout(() => setErrorOpen(true), 250);
      } finally {
        setWorking(false);
      }
    },
    [confirmTarget, working, queryClient],
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
          { text: 'block', style: 'destructive', onPress: () => { void handleBlock(false); } },
          { text: 'block & report', style: 'destructive', onPress: () => { void handleBlock(true); } },
          { text: 'cancel', style: 'cancel' },
        ]}
        footerLink={{
          text: 'see your blocked users',
          // TODO: remove `as any` in stage 2 when /profile/blocked-users is created
          onPress: () => router.push('/profile/blocked-users' as any),
        }}
        onClose={() => {
          if (!working) setConfirmTarget(null);
        }}
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

  return { requestBlock, modals };
}
