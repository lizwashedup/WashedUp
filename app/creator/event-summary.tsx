/** Event overview. Reads and navigation only; destination screens own actions. */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, Users, UserPlus, DollarSign, MessageCircle, ChevronRight, Pencil, Copy, ScanLine, Ticket, CalendarDays, MapPin } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../constants/Colors';
import { FontSizes, AfterglowType } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { formatCents } from '../../lib/ticketing';
import { INVITE_AUDIENCE_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { EventMediaImage } from '../../components/events/EventMediaImage';
import { GeneratedPoster } from '../../components/scene/GeneratedPoster';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import ProfileButton from '../../components/ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useEventSummary } from '../../hooks/useEventSummary';
import { eventSummaryId, eventSummaryDate, summaryStatusLine } from '../../lib/eventSummary';
export { summaryStatusLine } from '../../lib/eventSummary';

export default function EventSummaryScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; pageId?: string | string[] }>();
  const id = eventSummaryId(params.id);
  const pageId = eventSummaryId(params.pageId);
  const state = useEventSummary(id, pageId);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const {width, fontScale} = useWindowDimensions();
  const compactIdentity = width < 360 || fontScale > 1.2;
  const c = COMMUNITY_CHAT_GROUPING_ENABLED ? { paper: AfterglowColors.paper, ink: AfterglowColors.ink, muted: AfterglowColors.muted, accent: AfterglowColors.clay, surface: AfterglowColors.white, border: AfterglowColors.line, white: AfterglowColors.white } : { paper: Colors.parchment, ink: Colors.asphalt, muted: Colors.textMedium, accent: Colors.terracotta, surface: Colors.cardBg, border: Colors.border, white: Colors.white };
  const f = fonts;
  const [brokenArtwork, setBrokenArtwork] = useState<string | null>(null);
  const styles = useMemo(() => StyleSheet.create({
    page: { flex: 1, backgroundColor: c.paper },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4, gap: 8 },
    back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    headerText: { ...AfterglowType.contextTitle, fontFamily: f.semibold, color: c.ink, flex: 1 },
    body: { padding: 20, paddingTop: 20, paddingBottom: 40, gap: 24 },
    intro: { gap: 16 },
    identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    identityText: { flex: 1, minWidth: 0, gap: 8 },
    artwork: { width: compactIdentity ? 60 : 84, height: compactIdentity ? 80 : 105, borderRadius: 8, overflow: 'hidden', backgroundColor: c.border },
    artworkImage: { width: '100%', height: '100%' },
    artworkFallback: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    title: { ...AfterglowType.screenTitle, fontFamily: f.display, color: c.ink },
    status: { ...AfterglowType.section, fontFamily: f.semibold, color: c.accent, textTransform: 'capitalize' },
    meta: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    bodyText: { ...AfterglowType.body, fontFamily: f.regular, color: c.muted, flexShrink: 1 },
    stats: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 20, padding: 16, gap: 16, overflow: 'hidden' },
    statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
    stat: { flexGrow: 1, minWidth: 80, gap: 4 },
    value: { fontSize: FontSizes.displayLG, fontFamily: f.semibold, color: c.ink, flexShrink: 1 },
    sales: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: 12, gap: 4 },
    caption: { ...AfterglowType.caption, fontFamily: f.regular, color: c.muted },
    section: { ...AfterglowType.section, fontFamily: f.semibold, color: c.muted, marginBottom: 8 },
    rows: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 16, paddingHorizontal: 16, overflow: 'hidden' },
    row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingVertical: 12 },
    rowText: { ...AfterglowType.title, fontFamily: f.medium, color: c.ink, flex: 1 },
    button: { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
    buttonText: { ...AfterglowType.body, fontFamily: f.semibold, color: c.white },
    retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    retryText: { ...AfterglowType.body, fontFamily: f.semibold, color: c.accent },
    message: { padding: 24, gap: 16 },
    pending: { padding: 32, alignItems: 'center', gap: 12 },
  }), [c.paper, c.ink, c.muted, c.accent, c.surface, c.border, c.white, f.regular, f.medium, f.semibold, f.display, compactIdentity]);
  const back = () => router.canGoBack() ? router.back() : router.replace((pageId ? `/creator/${state.page?.entry === 'team' ? 'page-events' : 'page'}?id=${pageId}` : '/(creator)/events') as never);
  const open = (path: string, kind: 'events' | 'finance' | 'audience', parameter = 'id') => {
    if (!id || !state.canOpen(kind)) return;
    hapticLight();
    if (pageId && path === '/creator/event-form') {
      router.push(parameter === 'duplicateFrom'
        ? `/creator/page-event-reuse?pageId=${pageId}&sourceEventId=${id}` as never
        : `/creator/event-form?id=${id}&pageId=${pageId}${state.page?.entry === 'team' ? '&team=1' : ''}` as never);
      return;
    }
    router.push({ pathname: path, params: { [parameter]: id, ...(pageId && ['/creator/event-money', '/creator/event-messages', '/creator/event-rsvps'].includes(path) ? {pageId} : {}) } } as never);
  };
  const retry = (label: string, action: () => void, pending = false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={pending} onPress={action} style={styles.retry}><Text numberOfLines={1} style={styles.retryText}>{pending ? 'Checking…' : label}</Text></TouchableOpacity>;
  const message = (title: string, text: string, action?: () => void) => <ScrollView contentContainerStyle={styles.message}>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.bodyText}>{text}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={action ? 'Try again' : 'Back to events'} onPress={action ?? back} activeOpacity={0.86} style={styles.button}>
      <CreatorActionFill /><Text numberOfLines={1} style={styles.buttonText}>{action ? 'Try again' : 'Back to events'}</Text>
    </TouchableOpacity>
    {action && retry('Back to events', back)}
  </ScrollView>;
  const { identity, event, access, attendees, gross, registration, rsvps, permissions } = state;
  const freeRsvp = registration.data?.freeRsvp === true;
  // Unknown registration retains existing tools; only confirmed absence hides them.
  const ticketTools = !freeRsvp || registration.data?.hasTickets !== false;
  const showFinance = permissions.finance && ticketTools;
  const loading = identity.isLoading || (!!identity.viewerId && (event.isPending || access.isPending));
  const counts = permissions.audience ? attendees.data ?? null : null;
  const grossLabel = gross.data !== undefined ? formatCents(gross.data) : '—';
  const grossSize = grossLabel.length > 14 ? FontSizes.bodyLG : grossLabel.length > 10 ? FontSizes.displayMD : FontSizes.displayLG;
  const eventTitle = <Text accessibilityRole="header" style={styles.title}>{event.data?.title || 'Untitled event'}</Text>;
  const details = <><View style={styles.meta}><CalendarDays size={18} color={c.accent} /><Text style={styles.bodyText}>{eventSummaryDate(event.data?.event_date ?? '', event.data?.start_time ?? null)}</Text></View>
    <View style={styles.meta}><MapPin size={18} color={c.accent} /><Text style={styles.bodyText}>{event.data?.venue || 'Location to be set'}</Text></View></>;
  const row = (label: string, Icon: typeof Users, path: string, kind: 'events' | 'finance' | 'audience' = 'events', parameter = 'id') => <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} disabled={!state.ready} accessibilityState={{ disabled: !state.ready }} onPress={() => open(path, kind, parameter)} style={styles.row}><Icon size={20} color={c.accent} /><Text style={styles.rowText}>{label}</Text><ChevronRight size={18} color={c.muted} /></TouchableOpacity>;
  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to events" onPress={back} style={styles.back}><ArrowLeft size={22} color={c.ink} /></TouchableOpacity><Text numberOfLines={1} style={styles.headerText}>Event overview</Text><ProfileButton compact /></View>
    {!id ? message('Choose an event', 'Open an event from your events list.') : identity.error ? message('Couldn’t check your account', 'Try again to view this event.', () => { void identity.retry(); }) : loading ? <View style={styles.pending}><ActivityIndicator color={c.accent} /><Text style={styles.bodyText}>Loading event…</Text></View> : !identity.viewerId ? message('Sign in to continue', 'Your event tools are available when you’re signed in.') : access.isError || (event.isError && !event.data) ? message('Couldn’t load the overview', 'Try again to check this event and your access.', state.retryOverview) : !event.data ? message('Event unavailable', 'This event may have been removed, or it isn’t available to this account.') : !permissions.events && !permissions.finance ? message('Event tools unavailable', 'This account doesn’t have access to manage this event.') : <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.intro}>
        {compactIdentity && eventTitle}
        <View style={styles.identityRow}>
          <View style={styles.artwork}>
            {event.data.image_url && brokenArtwork !== `${id}:${event.data.image_url}`
              ? <EventMediaImage eventId={id} reference={event.data.image_url} style={styles.artworkImage} contentFit="cover" onError={() => setBrokenArtwork(`${id}:${event.data?.image_url}`)} />
              : <View style={styles.artworkFallback}><GeneratedPoster title={event.data.title || 'Event'} category={event.data.category} venue={event.data.venue} height={compactIdentity ? 80 : 105} compact surface="scene" /></View>}
          </View>
          <View style={styles.identityText}>
            <Text style={styles.status}>{summaryStatusLine(event.data.status, event.data.event_date)}</Text>
            {compactIdentity ? details : eventTitle}
          </View>
        </View>
        {!compactIdentity && details}
      </View>
      {(event.isError || access.isError) && <View><Text style={styles.bodyText}>Couldn’t refresh this event. Check again before opening its tools.</Text>{retry('Check again', state.retryOverview, event.isFetching || access.isFetching)}</View>}
      {(permissions.audience || showFinance) && <View style={styles.stats}>
        <LinearGradient pointerEvents="none" colors={[CreatorSurfaceColors.sunsetGoldLight, c.surface]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill} />
        {permissions.audience && <View style={styles.statsRow}>
          <>{freeRsvp && <View style={styles.stat}><Text style={styles.value}>{rsvps.data ?? '—'}</Text><Text style={styles.caption}>Going</Text></View>}{ticketTools && <><View style={styles.stat}><Text style={styles.value}>{counts ? counts.sold : '—'}</Text><Text style={styles.caption}>Active tickets</Text></View><View style={styles.stat}><Text style={styles.value}>{counts ? counts.checkedIn : '—'}</Text><Text style={styles.caption}>Checked in</Text></View></>}</>
        </View>}
        {showFinance && <View style={permissions.audience ? styles.sales : styles.stat}><Text style={styles.caption}>Gross ticket sales</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.value, {fontSize: grossSize}]}>{grossLabel}</Text></View>}
        {permissions.audience && ticketTools && attendees.isPending && <Text style={styles.caption}>Loading tickets…</Text>}
        {showFinance && gross.isPending && <Text style={styles.caption}>Loading sales…</Text>}
        {permissions.audience && ticketTools && attendees.isError && <View><Text style={styles.bodyText}>{counts ? 'Ticket counts couldn’t refresh.' : 'Ticket counts couldn’t load.'}</Text>{retry('Retry tickets', () => { if (state.canOpen('audience')) void attendees.refetch(); }, attendees.isFetching || !state.ready)}</View>}
        {showFinance && gross.isError && <View><Text style={styles.bodyText}>{gross.data !== undefined ? 'Ticket sales couldn’t refresh.' : 'Ticket sales couldn’t load.'}</Text>{retry('Retry sales', () => { if (state.canOpen('finance')) void gross.refetch(); }, gross.isFetching || !state.ready)}</View>}
        {showFinance && <Text style={styles.caption}>Gross sales are before fees and partial refunds. Open Earnings for fees and payout details.</Text>}
      </View>}
      {registration.isError && <View><Text style={styles.bodyText}>Joining details couldn’t load. Existing event tools are still available.</Text>{retry('Retry details', () => { if (state.canOpen('audience') || state.canOpen('finance')) void registration.refetch(); }, registration.isFetching || !state.ready)}</View>}
      {freeRsvp && permissions.audience && rsvps.isPending && <Text style={styles.caption}>Loading RSVPs…</Text>}
      {freeRsvp && permissions.audience && rsvps.isError && <View><Text style={styles.bodyText}>{rsvps.data === undefined ? 'RSVPs couldn’t load.' : 'RSVPs couldn’t refresh.'}</Text>{retry('Retry RSVPs', () => { if (state.canOpen('audience')) void rsvps.refetch(); }, rsvps.isFetching || !state.ready)}</View>}
      {permissions.audience && <View><Text style={styles.section}>{freeRsvp && !ticketTools ? 'People' : 'People & tickets'}</Text><View style={styles.rows}>
        {freeRsvp && row('RSVPs', Users, '/creator/event-rsvps', 'audience')}{ticketTools && <>{row('Attendees', Users, '/creator/attendees', 'audience')}{row('Check in', ScanLine, '/creator/check-in', 'audience')}{row('Tickets', Ticket, '/creator/tickets', 'audience')}</>}{row('Messages', MessageCircle, '/creator/event-messages', 'audience')}{INVITE_AUDIENCE_ENABLED && row('Invite people', UserPlus, '/creator/invite-audience', 'audience')}
      </View></View>}
      <View><Text style={styles.section}>Manage event</Text><View style={styles.rows}>
        {permissions.events && row('Edit event', Pencil, '/creator/event-form')}{pageId && showFinance && row('Ticket sales', DollarSign, '/creator/ticket-sales', 'finance')}{showFinance && row('Earnings', DollarSign, '/creator/event-money', 'finance')}{permissions.events && row('Duplicate', Copy, '/creator/event-form', 'events', 'duplicateFrom')}
      </View></View>
    </ScrollView>}
  </SafeAreaView>;
}
