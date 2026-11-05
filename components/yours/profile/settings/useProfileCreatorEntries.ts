import { useCallback, useRef, useState } from 'react';
import { getCreatorAccess, hasCreatorAccess, type CreatorAccess } from '../../../../lib/creatorMode';
import { getMyOrganizerProfile } from '../../../../lib/organizerProfile';
import { fetchMyGrants, type OperatorGrant } from '../../../../lib/operatorApplications';
import { withDeadline } from '../../../../lib/withTimeout';
import { verifyProfileOwner, requireProfileScope, isObsoleteProfileOperation, type ProfileOperationScope } from './profileOperations';

const CREATOR_READ_TIMEOUT_MS = 12_000;

/** Optional creator reads belong to the current Profile account and visit.
 * The screen owns navigation and calls resetCreatorAttempt on each focus.
 * An unfinished or failed creator read must not inherit the main profile cache.
 */
export function useProfileCreatorEntries(pageScope: ProfileOperationScope) {
  const { userId } = pageScope;
  const [creatorAccess, setCreatorAccess] = useState<CreatorAccess | null>(null);
  const [organizerName, setOrganizerName] = useState<string | null>(null);
  const [pendingGrants, setPendingGrants] = useState<OperatorGrant[]>([]);
  const [creatorError, setCreatorError] = useState(false);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const creatorsAttempt = useRef<object | null>(null);
  const creatorsNeedRefresh = useRef(true);
  const resetCreatorAttempt = useCallback(() => { creatorsAttempt.current = null; }, []);
  const fetchCreatorEntries = async () => {
    if (!pageScope.isCurrent() || creatorsAttempt.current) return;
    creatorsNeedRefresh.current = true;
    const attempt = {}; creatorsAttempt.current = attempt; setLoadingCreators(true); setCreatorError(false);
    const scope = { userId, isCurrent: () => pageScope.isCurrent() && creatorsAttempt.current === attempt };
    try {
      await verifyProfileOwner(scope);
      const [accessResult, grantsResult] = await Promise.allSettled([
        withDeadline(getCreatorAccess(), CREATOR_READ_TIMEOUT_MS, 'Creator access'),
        withDeadline(fetchMyGrants(), CREATOR_READ_TIMEOUT_MS, 'Creator applications'),
      ]);
      await verifyProfileOwner(scope);
      requireProfileScope(scope);
      let failed = accessResult.status === 'rejected' || grantsResult.status === 'rejected';
      // These are independent original settings destinations. A failed
      // application or optional name lookup must not hide confirmed access.
      if (grantsResult.status === 'fulfilled') setPendingGrants(grantsResult.value.filter(g => g.status === 'applied' || g.status === 'in_review' || g.status === 'needs_more_info'));
      if (accessResult.status === 'fulfilled') {
        const access = accessResult.value;
        setCreatorAccess(hasCreatorAccess(access) ? access : null);
        if (access?.hasEventHostGrant) {
          try {
            const organizer = await withDeadline(getMyOrganizerProfile(), CREATOR_READ_TIMEOUT_MS, 'Organizer name');
            await verifyProfileOwner(scope);
            requireProfileScope(scope);
            setOrganizerName(organizer?.display_name ?? null);
          } catch (error) { requireProfileScope(scope); if (isObsoleteProfileOperation(error)) throw error; failed = true; }
        } else setOrganizerName(null);
      }
      requireProfileScope(scope);
      creatorsNeedRefresh.current = failed;
      setCreatorError(failed);
    } catch (error) { if (scope.isCurrent() && !isObsoleteProfileOperation(error)) setCreatorError(true); }
    finally { if (scope.isCurrent()) { setLoadingCreators(false); creatorsAttempt.current = null; } }
  };
  return { creatorAccess, organizerName, pendingGrants, creatorError, loadingCreators, creatorsNeedRefresh, fetchCreatorEntries, resetCreatorAttempt };
}
