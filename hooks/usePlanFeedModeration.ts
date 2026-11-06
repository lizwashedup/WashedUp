import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useBlock, type BlockOperationScope } from './useBlock';

type FeedCard = { id: string; creator: { id: string; first_name_display: string | null } | null };
type ReportTarget = { eventId: string; userId: string; userName: string; scope: BlockOperationScope };

export function usePlanFeedModeration(
  userId: string | null, isCurrentAccount: () => boolean,
  plans: readonly FeedCard[], featured: readonly FeedCard[],
) {
  const { blockUser } = useBlock();
  const [scope, setScope] = useState<BlockOperationScope | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    let active = true;
    setScope({ userId, isCurrent: () => active && isCurrentAccount() });
    return () => { active = false; setScope(null); setReport(null); };
  }, [userId, isCurrentAccount]));

  // Featured rows are removed from the ordinary list before rendering.
  const findCreator = useCallback((id: string) =>
    (featured.find(card => card.id === id) ?? plans.find(card => card.id === id))?.creator,
  [featured, plans]);
  const latest = useRef(findCreator);
  useLayoutEffect(() => { latest.current = findCreator; }, [findCreator]);

  const targetFor = useCallback((eventId: string): ReportTarget | null => {
    const creator = findCreator(eventId);
    if (!creator?.id || !scope?.isCurrent() || scope.userId !== userId) return null;
    // An iOS menu callback can outlive the card that opened it.
    if (latest.current(eventId)?.id !== creator.id) return null;
    return { eventId, userId: creator.id, userName: creator.first_name_display ?? 'User', scope };
  }, [findCreator, scope, userId]);

  const handleReport = useCallback((id: string) => {
    const target = targetFor(id);
    if (target) setReport(target);
  }, [targetFor]);
  const handleBlock = useCallback((id: string) => {
    const target = targetFor(id);
    if (target) void blockUser(target.userId, target.userName, undefined, target.scope);
  }, [targetFor, blockUser]);

  const reportTarget = report?.scope.isCurrent() && report.scope.userId === userId ? report : null;
  // The mini profile closes itself before handing off either person-level action.
  const reportPerson = (id: string, name: string) => {
    if (scope?.isCurrent() && id && id !== scope.userId) setReport({ userId: id, userName: name, eventId: '', scope });
  };
  const blockPerson = (id: string, name: string) => {
    if (scope?.isCurrent() && id && id !== scope.userId) void blockUser(id, name, undefined, scope);
  };
  return { handleReport, handleBlock, reportPerson, blockPerson, reportTarget, scope,
    closeReport: () => setReport(current => current === reportTarget ? null : current) };
}
