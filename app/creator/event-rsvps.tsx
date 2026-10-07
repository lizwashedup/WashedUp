import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PageAction, PageFrame, pageStyles } from '../../components/creator/pages/PageFrame';
import Colors from '../../constants/Colors';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { eventSummaryId } from '../../lib/eventSummary';
import { getEventRsvpGuests, RsvpAccessDenied } from '../../lib/eventRsvpGuests';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { requestWithDeadline } from '../../lib/requestWithDeadline';

export default function EventRsvpsScreen() {
  const params = useLocalSearchParams<{ id?: string; pageId?: string }>();
  const id = eventSummaryId(params.id), pageId = eventSummaryId(params.pageId);
  const { scope, account } = useCreatorPageScope(`event-rsvps:${id ?? ''}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const [search, setSearch] = useState<{ scope: CreatorPageScope | null; value: string }>();
  const query = search?.scope === scope ? search.value : '';
  const retryLock = useRef<CreatorPageScope | null>(null);
  const read = useCallback(async (owned: CreatorPageScope) => {
    let active = true;
    const reading = { userId: owned.userId, isCurrent: () => active && owned.isCurrent() };
    try { return await requestWithDeadline(getEventRsvpGuests(id!, reading), 12_000); }
    catch (error) { if (error instanceof RsvpAccessDenied) return null; throw error; }
    finally { active = false; }
  }, [id]);
  const result = useCreatorPageRead(id ? scope : null, read);
  const retry = () => {
    if (!scope?.isCurrent() || result.loading || retryLock.current === scope) return;
    retryLock.current = scope;
    void result.refresh().catch(() => undefined).finally(() => { if (retryLock.current === scope) retryLock.current = null; });
  };
  const back = () => router.canGoBack() ? router.back() : router.replace((id ? `/creator/event-summary?id=${encodeURIComponent(id)}${pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''}` : '/creator/pages') as never);
  const rows = useMemo(() => result.data?.guests.filter(guest => guest.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [], [result.data, query]);
  const problem = !!account.error || !!result.error;
  const pending = account.isLoading || result.loading;
  return <PageFrame title="RSVPs" onBack={back} onRefresh={retry} refreshing={!!result.data && result.loading}>
    {!result.data ? <View style={s.empty}>
      {pending ? <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading RSVPs" /> : <>
        <Text style={[pageStyles.heading, { fontFamily: fonts.display }]}>{problem ? 'Couldn’t load RSVPs' : id ? 'RSVPs unavailable' : 'Choose an event'}</Text>
        <Text style={[pageStyles.body, { fontFamily: fonts.regular }]}>{problem ? 'Check your connection and try again.' : id ? 'The guest list is not available for this account.' : 'Open RSVPs from your event overview.'}</Text>
        {problem && <PageAction title="Try again" compact singleLine onPress={() => { if (account.error) void account.retry(); else retry(); }} />}
      </>}
    </View> : <>
      <Text accessibilityRole="header" style={[pageStyles.heading, { fontFamily: fonts.display }]}>{result.data.title}</Text>
      <Text style={[pageStyles.body, { fontFamily: fonts.regular }]}>{result.data.guests.length} {result.data.guests.length === 1 ? 'person' : 'people'} going</Text>
      {result.error && <View style={pageStyles.notice} accessibilityRole="alert"><Text style={[pageStyles.small, { fontFamily: fonts.regular }]}>RSVPs couldn’t refresh. Showing the last confirmed guest list.</Text><PageAction title="Try again" compact singleLine disabled={result.loading} onPress={retry} /></View>}
      {result.data.guests.length > 0 && <TextInput accessibilityLabel="Search RSVP guests" placeholder="Search by name" placeholderTextColor={Colors.textMedium} style={[pageStyles.input, { fontFamily: fonts.regular }]} value={query} onChangeText={value => setSearch({ scope, value })} autoCorrect={false} />}
      {rows.map(guest => <View key={guest.id} style={[pageStyles.row, s.row]}>
        {guest.photo ? <Image source={{ uri: guest.photo }} style={s.photo} accessibilityLabel={`${guest.name} profile photo`} /> : <View style={[s.photo, s.initial]}><Text style={[pageStyles.rowTitle, { fontFamily: fonts.medium }]}>{guest.name.slice(0, 1)}</Text></View>}
        <View style={s.name}><Text style={[pageStyles.rowTitle, { fontFamily: fonts.medium }]}>{guest.name}</Text><Text style={[pageStyles.small, { fontFamily: fonts.regular }]}>Going</Text></View>
      </View>)}
      {!rows.length && <View style={s.empty}><Text style={[pageStyles.body, { fontFamily: fonts.regular }]}>{query.trim() ? 'No guests match this name.' : 'People will appear here when they join your event.'}</Text><PageAction title={query.trim() ? 'Clear search' : 'Event overview'} compact singleLine onPress={query.trim() ? () => setSearch({ scope, value: '' }) : back} /></View>}
    </>}
  </PageFrame>;
}
const s = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { flex: 1, minWidth: 0, gap: 4 }, photo: { width: 44, height: 44, borderRadius: 22 }, initial: { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' }, empty: { paddingVertical: 24 } });
