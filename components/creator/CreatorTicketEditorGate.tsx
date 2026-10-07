import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { canReadCreatorTickets } from '../../lib/creatorTicketRead';
import { resolveCreatorEventEntry } from '../../lib/creatorEventEntry';
import { getCreatorAccess, canManageEvents } from '../../lib/creatorMode';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { PageFrame, PageAction, pageStyles } from './pages/PageFrame';
import Colors from '../../constants/Colors';
import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';

/** Same admission as ticket setup; preserve a draft during a temporary focus change. */
export function CreatorTicketEditorGate({ eventId, recordId, title, children }: {
  eventId?: string; recordId?: string; title: string;
  children: (scope: CreatorPageScope, active: boolean) => React.ReactNode;
}) {
  const {fonts}=useAfterglowFonts(true,'creator');
  const { scope, account } = useCreatorPageScope(`${eventId}:${recordId}`);
  const read = useCallback(async (owned: CreatorPageScope) => {
    if (!await canReadCreatorTickets(eventId!, owned)) return false;
    if (CREATOR_PAGES_ENABLED) {
      const entry = await resolveCreatorEventEntry({kind:'edit',id:eventId!},owned);
      if (!owned.isCurrent()) throw Error('This event visit has ended.');
      if (entry.kind === 'page') return true;
    }
    const access = await getCreatorAccess();
    if (!owned.isCurrent()) throw Error('This event visit has ended.');
    return access.hasEventHostGrant || canManageEvents(access);
  }, [eventId]);
  const access = useCreatorPageRead(eventId && recordId ? scope : null, read);
  const identity = `${account?.epoch}:${scope?.userId}:${eventId}:${recordId}`;
  const admitted = useRef<string | null>(null);
  if (access.data === true && !access.error) admitted.current = identity;
  if (access.data === false) admitted.current = null;
  const active = !!scope?.isCurrent() && access.data === true && !access.loading && !access.error;
  return <>
    {scope && admitted.current === identity && <View key={identity} style={{flex:1,display:active?'flex':'none'}}>{children(scope,active)}</View>}
    {!active && <PageFrame title={title}>
      {account?.isLoading || access.loading ? <ActivityIndicator accessibilityLabel="Checking event access" color={Colors.terracotta}/> : <>
        <Text style={[pageStyles.small,{fontFamily:fonts.regular}]}>{access.error || account?.error ? 'Couldn’t check access to this event.' : 'This editor isn’t available for this event and account.'}</Text>
        <PageAction compact title="Try again" onPress={()=>{void (account?.error?account.retry():access.refresh()).catch(()=>undefined);}}/>
      </>}
    </PageFrame>}
  </>;
}
