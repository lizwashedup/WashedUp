import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PageAction, PageFrame } from '../creator/pages/PageFrame';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { attendeeMessageEventRoute, loadAttendeeMessageNotice, markAttendeeMessageRead } from '../../lib/attendeeMessageNotification';
import { EventMessagePreference } from './EventMessagePreference';

/** Reuses the event route; delivered copy remains readable when its event disappears. */
export function AttendeeMessageLanding({ eventId, notificationId }: { eventId: string; notificationId: string }) {
  const { scope, account } = useCreatorPageScope(`event-update:${eventId}:${notificationId}`);
  const { fonts } = useAfterglowFonts();
  const read = useCallback((owned: CreatorPageScope) => loadAttendeeMessageNotice(notificationId, eventId, owned), [eventId, notificationId]);
  const { data, error, loading, refresh } = useCreatorPageRead(scope, read);
  const current = !!scope?.isCurrent() && !account.error && !account.isLoading;
  const notice = current ? data : undefined;
  const busy = account.isLoading || (current && loading);
  const failed = account.error || (current && error);
  const navigation = useRef<CreatorPageScope | null>(null);

  useEffect(() => {
    if (!notice || !scope?.isCurrent()) return;
    // Optional bookkeeping never withholds the message or blocks navigation.
    void markAttendeeMessageRead(notice.id, scope).catch(() => undefined);
  }, [notice, scope]);

  const goToScene = () => router.replace('/(tabs)/explore');
  const goBack = () => router.canGoBack() ? router.back() : goToScene();
  const openEvent = () => {
    if (!current || !scope || !notice?.eventId || navigation.current === scope) return;
    navigation.current = scope;
    // Drop only the update parameter. Event visibility/admission stays with the original route.
    router.replace(attendeeMessageEventRoute(notice.eventId) as never);
  };

  return <PageFrame title="Event update" onBack={goBack}>
    <View style={s.column}>
      {notice ? <>
        <Text style={[s.date, { fontFamily: fonts.regular }]}>{new Date(notice.createdAt).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })}</Text>
        <Text accessibilityRole="header" style={[s.subject, { fontFamily: fonts.semibold }]}>{notice.title}</Text>
        {!!notice.body && <Text selectable style={[s.body, { fontFamily: fonts.regular }]}>{notice.body}</Text>}
        <View style={s.destination}>
          {notice.eventId ? <PageAction title="Open event" compact singleLine primary onPress={openEvent} /> :
            <Text style={[s.supporting, { fontFamily: fonts.regular }]}>This event is no longer available. You can still read its update here.</Text>}
          <PageAction title="Back to Scene" compact singleLine quiet onPress={goToScene} />
        </View>
        {notice.eventId && <EventMessagePreference eventId={notice.eventId} />}
      </> : busy ? <ActivityIndicator accessibilityLabel="Loading update" color={Colors.terracotta} /> : <>
        <Text accessibilityLiveRegion="polite" style={[s.body, { fontFamily: fonts.regular }]}>
          {failed ? 'Could not load this update. Please try again.' : !scope ? 'Sign in to the account that received this update.' : 'This update is no longer available for this account.'}
        </Text>
        {failed && <PageAction title="Try again" compact singleLine quiet onPress={() => {
          void (account.error ? account.retry() : refresh()).catch(() => undefined);
        }} />}
        <PageAction title="Back to Scene" compact singleLine quiet onPress={goToScene} />
      </>}
    </View>
  </PageFrame>;
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 12 },
  date: { ...T.caption, color: C.muted },
  subject: { ...T.pageSection, color: C.ink },
  body: { ...T.message, color: C.ink },
  supporting: { ...T.body, color: C.muted },
  destination: { marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, gap: 4 },
});
