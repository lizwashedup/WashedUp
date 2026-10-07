import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Calendar, MapPin, Ticket, Users } from 'lucide-react-native';
import LinkifiedText from '../LinkifiedText';
import { MapView, Marker } from '../MapView';
import Colors, { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T, type AfterglowFontFamilies } from '../../constants/Typography';

export type DetailPerson = { user_id: string; first_name_display: string | null; profile_photo_url: string | null; handle?: string | null };
type Props = {
  fonts: AfterglowFontFamilies;
  mapCoords?: { latitude: number; longitude: number } | null;
  visibleHandles?: Readonly<Record<string, string>>;
  plan: {
    title: string; image_url: string | null; description: string | null; host_message: string | null;
    primary_vibe: string | null; location_text: string | null; tickets_url: string | null;
    creator: { id: string; first_name_display: string | null; profile_photo_url: string | null; handle?: string | null } | null;
  };
  date: string; time: string; audience: string | null; ageLabel?: string | null; featuredLabel: string | null;
  capacity: string; capacityDetail?: string; circleLabel?: string; circleExplanation?: string;
  members: DetailPerson[]; memberCount: number; membersLoading: boolean; membersError: boolean;
  onRetryMembers: () => void; onProfile: (id: string) => void; onCalendar: () => void; onMap: () => void; onTickets: () => void;
  sourceCancelled: boolean; happeningNow: boolean;
};

/** The reviewed detail hierarchy. Data, admission and navigation stay in the route. */
export function PlanDetailOverview(p: Props) {
  const s = useMemo(() => makeStyles(p.fonts), [p.fonts]);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [failedPortraits, setFailedPortraits] = useState<Record<string, string>>({});
  const creator = p.plan.creator;
  const person = (who: DetailPerson, creatorRow = false) => {
    const name = who.first_name_display?.trim() || 'Member';
    // Never trust a handle attached to a public attendee/profile row.
    const handle = p.visibleHandles?.[who.user_id]?.trim().replace(/^@+/, '');
    return <TouchableOpacity key={who.user_id} style={[s.person, !creatorRow && s.attendee]} accessibilityRole="button" accessibilityLabel={`View ${name}${handle ? `, @${handle}` : ''}`} onPress={() => p.onProfile(who.user_id)}>
      {who.profile_photo_url && failedPortraits[who.user_id] !== who.profile_photo_url ? <Image source={{ uri: who.profile_photo_url }} style={s.portrait} contentFit="cover" onError={() => setFailedPortraits(previous => ({ ...previous, [who.user_id]: who.profile_photo_url! }))} /> :
        <View style={[s.portrait, s.monogram]}><Text style={s.initial}>{name[0].toUpperCase()}</Text></View>}
      <View style={[s.personText, !creatorRow && s.attendeeText]}><Text style={s.personName} numberOfLines={2}>{name}</Text>{handle ? <Text style={s.meta}>@{handle}</Text> : null}</View>
      {creatorRow ? <Text style={s.meta}>posted</Text> : null}
    </TouchableOpacity>;
  };
  const detailRow = (Icon: typeof Calendar, main: string, sub: string | null, action?: string, onPress?: () => void) =>
    <View style={s.detailRow}><Icon size={19} color={C.clay} strokeWidth={1.8} /><View style={s.detailText}><Text style={s.detailMain}>{main}</Text>{sub ? <Text style={s.meta}>{sub}</Text> : null}</View>{action ? <TouchableOpacity style={s.linkButton} accessibilityRole="button" accessibilityLabel={action} onPress={onPress}><Text style={s.link}>{action}</Text></TouchableOpacity> : null}</View>;
  return <View>
    {p.plan.image_url && failedImage !== p.plan.image_url ? <Image source={{ uri: p.plan.image_url }} style={s.hero} contentFit="cover" onError={() => setFailedImage(p.plan.image_url)} /> : null}
    <View style={s.tags}>
      {[p.featuredLabel || p.plan.primary_vibe, p.audience].filter(Boolean).map((label, i) => <View key={`${label}-${i}`} style={s.tag}><Text style={s.tagText}>{label}</Text></View>)}
      {p.ageLabel ? <View style={s.tag}><Text accessibilityLabel={`Age range: ${p.ageLabel}`} style={s.tagText}>{p.ageLabel}</Text></View> : null}
      {p.happeningNow ? <View style={s.liveTag}><Text style={s.tagText}>Happening now</Text></View> : null}
    </View>
    <Text accessibilityRole="header" style={s.title}>{p.plan.title}</Text>
    {p.circleLabel ? <View style={s.circle}><View style={s.circleHeading}><Users size={16} color={C.clay}/><Text style={s.circleTitle}>{p.circleLabel}</Text></View>{p.circleExplanation ? <Text style={s.body}>{p.circleExplanation}</Text> : null}</View> : null}
    {p.sourceCancelled ? <View style={s.notice}><Text style={s.body}>The event this plan came from was cancelled. Your plans are your own.</Text></View> : null}
    {creator ? person({ ...creator, user_id: creator.id }, true) : <Text style={s.meta}>Creator details unavailable</Text>}
    {p.plan.host_message ? <View style={s.note}><LinkifiedText text={p.plan.host_message} style={s.body} linkStyle={s.link} /></View> : null}
    {p.plan.description ? <View style={s.about}><Text accessibilityRole="header" style={s.heading}>The plan</Text><LinkifiedText text={p.plan.description} style={s.body} linkStyle={s.link} /></View> : null}
    <View style={s.details}>
      {detailRow(Calendar, p.date, p.time, 'Calendar', p.onCalendar)}
      {p.plan.location_text ? detailRow(MapPin, p.plan.location_text, null, 'Map', p.onMap) : null}
      {p.mapCoords && p.plan.location_text ? <TouchableOpacity style={s.mapWrap} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`Open map for ${p.plan.location_text}`} onPress={p.onMap}>
        <MapView style={s.map} initialRegion={{ ...p.mapCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }} scrollEnabled={false} zoomEnabled={false} pitchEnabled={false} rotateEnabled={false} toolbarEnabled={false} liteMode={Platform.OS === 'android'} pointerEvents="none">
          <Marker coordinate={p.mapCoords} />
        </MapView>
      </TouchableOpacity> : null}
      {p.plan.tickets_url ? detailRow(Ticket, 'Tickets required', 'Joining this plan does not include a ticket.', 'Tickets', p.onTickets) : null}
      {detailRow(Users, p.capacity, p.capacityDetail || null)}
    </View>
    <View style={s.people}><Text accessibilityRole="header" style={s.heading}>Who’s going</Text>
      {p.membersError ? <View><Text style={s.body}>Couldn’t load who’s going.</Text><TouchableOpacity accessibilityRole="button" style={s.retry} onPress={p.onRetryMembers}><Text style={s.link}>Try again</Text></TouchableOpacity></View> :
        p.membersLoading ? <View style={s.loading}><ActivityIndicator color={C.clay}/><Text style={s.meta}>Loading people…</Text></View> :
          p.members.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.attendees}>{p.members.map(who => person(who))}</ScrollView> : <Text style={s.body}>{p.memberCount > 0 ? `${p.memberCount} ${p.memberCount === 1 ? 'person is' : 'people are'} going` : 'Be part of the plan.'}</Text>}
    </View>
  </View>;
}

function makeStyles(f: AfterglowFontFamilies) { return StyleSheet.create({
  hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, marginBottom: 18 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tag: { backgroundColor: C.avatar, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  liveTag: { backgroundColor: Colors.goldenAmberTint15, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  tagText: { ...T.caption, fontFamily: f.semibold, color: C.ink, textTransform: 'capitalize' },
  title: { ...T.identity, fontFamily: f.display, color: C.ink, marginBottom: 16 },
  circle: { gap: 7, marginBottom: 22 }, circleHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  circleTitle: { ...T.body, fontFamily: f.semibold, color: C.ink, flexShrink: 1 },
  notice: { borderLeftWidth: 2, borderColor: Colors.goldAccent, paddingLeft: 12, marginBottom: 18 },
  details: { backgroundColor: C.white, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, borderColor: C.subtleLine, paddingHorizontal: 16, paddingVertical: 8, marginTop: 12, marginBottom: 12 },
  mapWrap: { borderRadius: 12, overflow: 'hidden', marginVertical: 8 }, map: { width: '100%', height: 150 },
  attendees: { gap: 12, paddingVertical: 4 }, attendee: { width: 76, flexDirection: 'column', gap: 6, alignItems: 'center' }, attendeeText: { flex: 0, alignItems: 'center' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  detailText: { flex: 1, minWidth: 0, gap: 3 }, detailMain: { ...T.message, fontFamily: f.medium, color: C.ink },
  linkButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  link: { ...T.body, fontFamily: f.semibold, color: C.clay },
  person: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  portrait: { width: 44, height: 44, borderRadius: 22 }, monogram: { backgroundColor: C.avatar, alignItems: 'center', justifyContent: 'center' },
  initial: { ...T.contextTitle, fontFamily: f.semibold, color: C.muted }, personText: { flex: 1, minWidth: 0, gap: 2 },
  personName: { ...T.message, fontFamily: f.semibold, color: C.ink }, meta: { ...T.body, fontFamily: f.regular, color: C.muted },
  note: { borderLeftWidth: 3, borderColor: Colors.goldAccent, backgroundColor: C.white, borderRadius: 16, padding: 16, marginTop: 8, marginBottom: 16 },
  body: { ...T.message, fontFamily: f.regular, color: C.muted }, heading: { ...T.contextTitle, fontFamily: f.semibold, color: C.ink, marginBottom: 12 },
  about: { marginVertical: 14, gap: 2 }, people: { borderTopWidth: 1, borderColor: C.subtleLine, paddingTop: 18, marginTop: 12, marginBottom: 18 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
}); }
