import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowUpRight, CalendarDays, Copy, Ellipsis, ExternalLink, SlidersHorizontal } from 'lucide-react-native';
import MenuCard, { type AnchorRect, type MenuRow } from '../../menu/MenuCard';
import { EventMediaImage } from '../../events/EventMediaImage';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { formatEventDateLA } from '../../../lib/laDate';
import Colors, { AfterglowColors as C, CreatorSurfaceColors as Surface } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';

type Props = {
  event: { id: string; title: string; status: string; event_date?: string | null; image_url?: string | null };
  ready: boolean;
  displayStatus?: string;
  isCurrent: () => boolean;
  editLabel: string;
  onEdit: () => void;
  onManage: () => void;
  onDuplicate: () => void;
  onView?: () => void;
};

/** One quiet list row; the existing destinations remain in its anchored menu. */
export function CreatorEventRow({ event, displayStatus, ready, isCurrent, editLabel, onEdit, onManage, onDuplicate, onView }: Props) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { fontScale } = useWindowDimensions();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const lifetime = useRef(0);
  const current = useRef({ ready, isCurrent }); current.current = { ready, isCurrent };
  useEffect(() => { if (!ready) { lifetime.current++; setAnchor(null); } }, [ready]);
  useEffect(() => () => { lifetime.current++; }, []);
  const invoke = (action: () => void) => () => {
    if (current.current.ready && current.current.isCurrent()) action();
  };
  const eventDay = formatEventDateLA(event.event_date, { day: 'numeric' });
  const eventMonth = formatEventDateLA(event.event_date, { month: 'short' });
  const rows: MenuRow[] = [
    { key: 'manage', icon: SlidersHorizontal, label: 'Manage event', subtitle: 'Details and event tools', onPress: invoke(onManage) },
    { key: 'duplicate', icon: Copy, label: 'Duplicate event', subtitle: 'Start a new private draft', onPress: invoke(onDuplicate) },
    ...(event.status === 'Live' && onView ? [{ key: 'view', icon: ExternalLink, label: 'View in Scene', subtitle: 'See the published event', dividerBefore: true, muted: true, onPress: invoke(onView) }] : []),
  ];
  return <View style={styles.row}>
    <View style={styles.top}>
    <View style={[styles.content, fontScale > 1.3 && styles.stacked]}>
      {event.image_url ? <View style={styles.artwork}><EventMediaImage eventId={event.id} reference={event.image_url}
        contentFit="contain" style={styles.photo} accessibilityLabel={`${event.title} artwork`} /></View> : <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dateArtwork}>{eventDay ? <><Text style={[styles.dateMonth, { fontFamily: fonts.medium }]}>{eventMonth.toUpperCase()}</Text><Text style={[styles.dateDay, { fontFamily: fonts.display }]}>{eventDay}</Text></> : <CalendarDays size={20} strokeWidth={1.4} color={C.muted} />}</View>}
      <Pressable accessibilityRole="button" accessibilityLabel={editLabel} accessibilityState={{ disabled: !ready }} disabled={!ready}
        onPress={invoke(onEdit)} style={[styles.event, fontScale > 1.3 && styles.fullWidth]}>
        <Text style={[styles.title, { fontFamily: fonts.semibold }]}>{event.title}</Text>
        {event.event_date !== undefined && <Text style={[styles.meta, { fontFamily: fonts.regular }]}>{formatEventDateLA(event.event_date) || 'Date to come'}</Text>}
        <Text style={[styles.status, { fontFamily: fonts.medium }]}>{displayStatus ?? (event.status === 'Draft' ? 'Private draft' : event.status === 'Live' ? 'Live' : event.status)}</Text>
      </Pressable>
    </View>
    <View ref={trigger} collapsable={false} style={styles.trigger}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${event.title}`} accessibilityHint="Manage, duplicate, or view this event"
        accessibilityState={{ disabled: !ready, expanded: !!anchor }} disabled={!ready} style={styles.more}
        onPress={invoke(() => {
          const visit = lifetime.current;
          trigger.current?.measureInWindow((x, y, width, height) => {
            if (visit === lifetime.current && current.current.ready && current.current.isCurrent()) setAnchor({ x, y, width, height });
          });
        })}><Ellipsis size={20} color={C.muted} /></Pressable>
    </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${event.title}`} disabled={!ready}
      accessibilityState={{disabled:!ready}} onPress={invoke(onManage)}
      style={styles.manage}>
      <SlidersHorizontal size={16} strokeWidth={1.6} color={C.ink}/>
      <Text style={[styles.manageLabel,{fontFamily:fonts.medium}]}>Manage event</Text>
      <ArrowUpRight size={18} strokeWidth={1.6} color={C.ink}/>
    </Pressable>
    <MenuCard visible={!!anchor && ready} anchor={anchor} placement="top-right" onClose={() => setAnchor(null)} rows={rows} appearance={{ fonts }} />
  </View>;
}

const styles = StyleSheet.create({
  row: {  backgroundColor: Colors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: C.subtleLine, borderRadius: 16, padding: 14, gap: 14, shadowColor: C.ink, shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: {width: 0, height: 3}, elevation: 1 },
  top: {flexDirection: 'row', alignItems: 'center', gap: 4},
  manage: {minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9, backgroundColor: Colors.inputBg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.subtleLine, paddingHorizontal: 12, paddingVertical: 10},
  manageLabel: {...T.caption, color: C.ink, flex: 1},
  dateArtwork: { width: 52, height: 68, borderRadius: 10, backgroundColor: Colors.inputBg, justifyContent: 'center', alignItems: 'center' },
  dateMonth: { ...T.timestamp, color: C.muted },
  dateDay: { ...T.pageTitle, color: C.ink },
  content: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start' },
  artwork: { width: 58, height: 76, borderRadius: 6, overflow: 'hidden', backgroundColor: C.white, justifyContent: 'center' },
  photo: { width: 58, height: 76 },
  event: { flex: 1, minWidth: 0, minHeight: 60, justifyContent: 'center', gap: 3 },
  fullWidth: { flex: undefined, width: '100%' },
  title: { ...T.title, color: C.ink },
  meta: { ...T.caption, color: C.muted },
  status: { ...T.caption, color: C.muted },
  trigger: { width: 44, alignSelf: 'center' },
  more: { width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
