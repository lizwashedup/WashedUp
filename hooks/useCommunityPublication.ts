import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreatorPageScope } from './useCreatorPageScope';
import { useCreatorPageRead } from './useCreatorPageRead';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { changeCommunityPublication, checkCommunityPublication, publicationAttempt, readCommunityPublication,
  readCommunityPublicationAttempt, readCommunityDiscoveryAvailable, type CommunityPublicationAction, type CommunityPublicationAttempt } from '../lib/communityPublication';
import { friendlyError } from '../lib/friendlyError';

export function useCommunityPublication(communityId: string) {
  const observed = useCreatorPageScope(`community-publication:${communityId}`);
  const scope = !observed.account.isLoading && !observed.account.error ? observed.scope : null;
  const client = useQueryClient();
  const load = useCallback(async (owned: CreatorPageScope) => ({
    state: await readCommunityPublication(communityId, owned),
    attempt: await readCommunityPublicationAttempt(communityId, owned),
    discoveryAvailable: await readCommunityDiscoveryAvailable(communityId, owned),
  }), [communityId]);
  const saved = useCreatorPageRead(scope, load);
  const [activity, setActivity] = useState<{ scope: CreatorPageScope; busy: boolean; action?: CommunityPublicationAction | 'check'; message?: string; attempt?: CommunityPublicationAttempt | null; unresolved?: boolean }>();
  const own = activity?.scope === scope ? activity : undefined;
  const lock = useRef<object | null>(null);
  const busy = !!own?.busy;
  const attempt = own?.attempt !== undefined ? own.attempt : saved.data?.attempt;
  const state = saved.data?.state;
  const ready = !!scope && scope.isCurrent() && !!state && !saved.loading && !saved.error && !busy && !attempt && !own?.unresolved;
  const invalidate = () => {
    for (const queryKey of [['creator-access'], ['community-page', communityId], ['scene-communities']]) {
      void client.invalidateQueries({ queryKey });
    }
  };
  async function run(action: CommunityPublicationAction | 'check' | 'retry') {
    if (!scope?.isCurrent() || lock.current || (action !== 'check' && action !== 'retry' && !ready)) return false;
    if ((action === 'show' || action === 'hide') && !saved.data?.discoveryAvailable) return false;
    if (action === 'retry' && !attempt) return false;
    const owned = scope, task = {};
    lock.current = task;
    const current = () => owned.isCurrent() && lock.current === task;
    const operationScope = { userId: owned.userId, isCurrent: current };
    const activeAction = action === 'retry' ? attempt!.action : action;
    setActivity({ scope: owned, busy: true, action: activeAction, attempt });
    let confirmed = false;
    try {
      if (action === 'check') {
        const result = await checkCommunityPublication(communityId, operationScope);
        if (!current()) return false;
        confirmed = !result.attempt;
        setActivity({ scope: owned, busy: true, action: activeAction, attempt: result.attempt,
          message: result.attempt ? 'This change is still unconfirmed. You can check again or retry the same change.' : 'Saved status checked.' });
      } else {
        const next = action === 'retry' ? attempt! : publicationAttempt(state!, action);
        await changeCommunityPublication(next, operationScope);
        if (!current()) return false;
        confirmed = true;
        setActivity({ scope: owned, busy: true, action: activeAction, attempt: null, message: 'Saved.' });
      }
      invalidate();
      await saved.refresh();
    } catch (failure) {
      if (!current()) return false;
      let retained: CommunityPublicationAttempt | null | undefined;
      try { retained = await readCommunityPublicationAttempt(communityId, operationScope); } catch { /* Recovery must remain available. */ }
      if (current()) setActivity({ scope: owned, busy: true, action: activeAction, attempt: retained,
        unresolved: true, message: friendlyError(failure, 'Couldn’t confirm this change. Check the saved status.') });
    } finally {
      if (current()) setActivity(old => old?.scope === owned ? { ...old, busy: false } : old);
      if (lock.current === task) lock.current = null;
    }
    return confirmed;
  }
  return { state, attempt, busy, activeAction: busy ? own?.action : undefined, ready, scope, discoveryAvailable: saved.data?.discoveryAvailable === true,
    loading: observed.account.isLoading || saved.loading,
    error: observed.account.error?.message ?? saved.error,
    message: own?.message,
    needsCheck: !!attempt || !!own?.unresolved,
    run,
    refresh: () => void (observed.account.error ? observed.account.retry() : saved.refresh()).catch(() => undefined),
  };
}
