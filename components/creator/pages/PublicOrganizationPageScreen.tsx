import { EventMediaImage } from '../../events/EventMediaImage';
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SceneDetailColors as C } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { usePublicPageScope } from '../../../hooks/usePublicPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { loadPublishedOrganizationPage, type PublishedOrganizationEvent } from '../../../lib/publishedOrganizationPage';
import type { PageImageScope } from '../../../lib/publishedPageCover';
import { OrganizationPageFollowControls } from './OrganizationPageFollowControls';
import { formatEventDateLA } from '../../../lib/laDate';
import { formatTicketPrice, normalizeTicketPrice } from '../../../lib/ticketPrice';
import { OrganizationPageUpdateNotice } from './OrganizationPageUpdateNotice';
import { PublishedPageCover } from './PublishedPageCover';
import ProfileButton from '../../ProfileButton';
import { ArrowLeft } from 'lucide-react-native';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';

export default function PublicOrganizationPageScreen({ pageId, updateId }: { pageId: string; updateId?: string }) {
  const { scope, account, focused } = usePublicPageScope(pageId), { fonts } = useAfterglowFonts(true, 'creator'), { width } = useWindowDimensions();
  const read = useCallback(async (owned: PageImageScope) => {
    let active = true;
    try { return await requestWithDeadline(loadPublishedOrganizationPage(pageId, { ...owned, isCurrent: () => active && owned.isCurrent() }), 12_000); }
    finally { active = false; }
  }, [pageId]);
  const pageRead = useCreatorPageRead(scope, read), page = pageRead.data?.page;
  const action = (title: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.action, primary && s.primary, disabled && { opacity: 0.55 }]}>
    <Text numberOfLines={1} style={[s.actionText, { fontFamily: fonts.semibold, color: primary ? C.actionText : C.text }]}>{title}</Text></Pressable>;
  const eventRow = (event: PublishedOrganizationEvent) => {
    const price = normalizeTicketPrice(event.ticket_price);
    const meta = [event.event_date ? formatEventDateLA(event.event_date, { month: 'short', day: 'numeric' }) : null, event.venue,
      price !== null ? formatTicketPrice(price) : null].filter(Boolean).join(' · ');
    return <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Open ${event.title}`} style={s.event}
      onPress={() => router.push(`/event/${event.id}` as never)}>
      {!!event.image_url && <EventMediaImage eventId={event.id} reference={event.image_url} style={{ width: 64, height: 72 }} contentFit="cover" accessibilityLabel="Event artwork" />}
      <View style={{ flex: 1 }}><Text style={[s.meta, { fontFamily: fonts.regular }]}>{meta}</Text><Text style={[s.eventTitle, { fontFamily: fonts.semibold }]}>{event.title}</Text></View>
      <Text accessible={false} style={[s.eventTitle, { fontFamily: fonts.regular }]}>›</Text>
    </Pressable>;
  };
  return <LinearGradient colors={[C.upper, C.middle, C.lower]} locations={C.gradientLocations} style={s.root}>
    {focused && <StatusBar style="dark" />}
    <SafeAreaView style={s.root} edges={['top','bottom']}><Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={() => router.back()}><ArrowLeft size={22} color={C.text}/></Pressable>
        <Text numberOfLines={1} style={[s.headerTitle, { fontFamily: fonts.semibold }]}>{page?.name ?? 'Organization'}</Text>
        <ProfileButton compact surface="scene"/></View>
      <ScrollView contentContainerStyle={s.content}>
        {!!updateId && <OrganizationPageUpdateNotice key={`${pageId}:${updateId}`} pageId={pageId} updateId={updateId} scope={scope} />}
        {(account.isLoading || pageRead.loading) && !page && <ActivityIndicator color={C.text} accessibilityLabel="Loading organization" />}
        {(account.error || pageRead.error) && <View style={s.notice}><Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>This page could not be loaded.</Text>
          {action('Try again', () => { void (account.error ? account.retry() : pageRead.refresh()).catch(() => undefined); })}</View>}
        {!account.isLoading && !pageRead.loading && !account.error && !pageRead.error && !page && <Text style={[s.body, { fontFamily: fonts.regular }]}>This organization page is unavailable.</Text>}
        {page && <>
          <Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>ORGANIZATION · {page.city.toUpperCase()}</Text>
          <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.display }]}>{page.name}</Text>
          <Text style={[s.purpose, { fontFamily: fonts.medium }]}>{page.purpose}</Text>
          {!!page.coverMediaId ? <PublishedPageCover pageId={pageId} mediaId={page.coverMediaId} height={(width-40)*0.675} surface="scene" /> : !!page.photoUrl && <Image source={{ uri: page.photoUrl }} contentFit="contain" cachePolicy="none" style={{ width: '100%', height: (width-40)*0.675 }} accessibilityLabel="Organization cover" />}
          <OrganizationPageFollowControls pageId={pageId} ownerId={page.ownerId} scope={scope} />
          {!!page.description && <Text style={[s.description, { fontFamily: fonts.regular }]}>{page.description}</Text>}
          <Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.semibold }]}>Our next gatherings</Text>
          {pageRead.data?.upcomingEvents.length ? pageRead.data.upcomingEvents.map(eventRow) : <Text style={[s.body, { fontFamily: fonts.regular }]}>No upcoming gatherings yet.</Text>}
          {!!pageRead.data?.pastEvents.length && <><Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.semibold }]}>Past gatherings</Text>{pageRead.data.pastEvents.map(eventRow)}</>}
        </>}
      </ScrollView>
    </SafeAreaView>
  </LinearGradient>;
}
const s = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 },
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems:'center' }, headerTitle: { ...T.body, color: C.text, flex: 1, minWidth:0 },
  content: { padding: 20, paddingBottom: 36 }, eyebrow: { ...T.timestamp, color: C.supporting, marginBottom: 14 },
  heading: { ...T.pageTitle, color: C.text, marginBottom: 14 }, purpose: { ...T.message, color: C.supporting, marginBottom: 18 },
  body: { ...T.message, color: C.text }, meta: { ...T.caption, color: C.supporting }, description: { ...T.message, color: C.supporting, marginTop: 20 },
  action: { alignSelf:'flex-start', minHeight:44, paddingHorizontal:18, paddingVertical:10, borderWidth:1, borderColor:C.line, borderRadius:24, justifyContent:'center', alignItems:'center' },
  primary: { backgroundColor: C.action }, actionText: { ...T.title }, notice: { gap: 12, marginVertical: 16 },
  section: { ...T.pageSection, color: C.text, marginTop: 32, marginBottom: 14 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  eventTitle: { ...T.title, color: C.text, marginTop: 4 },
});
