import React, { useCallback } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { loadCreatorPageWorkspace } from '../../../lib/creatorPageWorkspace';
import {loadCreatorPageTeamWorkspace} from '../../../lib/creatorPageTeamWorkspace';
import {ownerPageEventContext,teamPageEventContext,type CreatorPageEventContext} from '../../../lib/creatorPageEventContext';
import { getOperatorEvent, type OperatorEventRow } from '../../../lib/creatorEvents';
import { CreatorPageScopeExpired } from '../../../lib/creatorPageReview';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { PageAction, PageFrame, pageStyles } from './PageFrame';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { AfterglowColors } from '../../../constants/Colors';

export default function CreatorPageEventGate({ pageId, eventId, team = false, children }: {
  pageId: string; eventId: string; team?: boolean;
  children: (page: CreatorPageEventContext, scope: CreatorPageScope, event: OperatorEventRow) => React.ReactNode;
}) {
  const { scope, account } = useCreatorPageScope(`${pageId}:${eventId}:${team ? 'team' : 'owner'}`);
  const read = useCallback(async (owned: CreatorPageScope) => {
    // The entry hint selects a reader; it never grants authority. Teammate
    // entry makes no request for private owner applications or reviews.
    const workspace = team ? await loadCreatorPageTeamWorkspace(pageId, owned) : await loadCreatorPageWorkspace(pageId, owned);
    if (!workspace?.events.some(event => event.id === eventId)) return null;
    const context = 'draft' in workspace ? ownerPageEventContext(workspace) : teamPageEventContext(workspace);
    const event = await getOperatorEvent(eventId);
    if (!owned.isCurrent()) throw new CreatorPageScopeExpired();
    return event?.id === eventId ? { page: context, event } : null;
  }, [pageId, eventId, team]);
  const { data, error, loading, refresh } = useCreatorPageRead(scope, read);
  const { fonts } = useAfterglowFonts(true, 'creator');
  if (scope?.isCurrent() && !loading && !error && data?.event.id === eventId) {
    return <React.Fragment key={`${scope.userId}:${account.epoch}:${pageId}:${eventId}:${team}`}>{children(data.page, scope, data.event)}</React.Fragment>;
  }
  return <PageFrame title="Your event">
    {loading || account.isLoading ? <ActivityIndicator accessibilityLabel="Loading your event" color={AfterglowColors.clay} /> : <>
      <Text style={[pageStyles.body, { fontFamily: fonts.regular }]}>{error || account.error ? 'Could not load this event.' : 'This event is unavailable for this page and account.'}</Text>
      <PageAction title="Try again" onPress={() => { void (account.error ? account.retry() : refresh()).catch(() => undefined); }} />
    </>}
  </PageFrame>;
}
