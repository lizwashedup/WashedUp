/**
 * At-a-glance attendee list (spec 100 P0 #1, native read-only slice). One row
 * per SEAT (ticket_order_positions), never per order. Search by name or
 * reference code; filter by tier and by checked-in / refunded. Counts on top.
 *
 * §7: the read is organizer-only by RLS; we show buyer_name_snapshot and the
 * seat's status, never email / phone / internal fields. §8: statuses are text +
 * icon, never colour alone; real 44pt controls; every count has a text label.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Ban, ScanLine } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { countAttendees, getEventAttendees, isLiveSeat, type DoorAttendee } from '../../lib/ticketAttendees';

type StatusFilter = 'all' | 'in' | 'notin' | 'refunded';

export default function AttendeesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [tier, setTier] = useState<string | null>(null);

  const { data: attendees = [], isLoading } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });

  const counts = countAttendees(attendees);
  const tiers = useMemo(
    () => Array.from(new Set(attendees.map((a) => a.tierName).filter((t): t is string => !!t))),
    [attendees],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (q && !a.buyerName.toLowerCase().includes(q) && !a.referenceCode.toLowerCase().includes(q)) return false;
      if (tier && a.tierName !== tier) return false;
      if (status === 'in' && !(isLiveSeat(a) && a.checkedIn)) return false;
      if (status === 'notin' && !(isLiveSeat(a) && !a.checkedIn)) return false;
      if (status === 'refunded' && !(a.refundedCents > 0 || a.voided)) return false;
      return true;
    });
  }, [attendees, query, status, tier]);

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'everyone' },
    { key: 'notin', label: 'not in yet' },
    { key: 'in', label: 'checked in' },
    { key: 'refunded', label: 'refunded' },
  ];

  const seatLine = (a: DoorAttendee): string => {
    if (a.refundedCents > 0 || a.voided) return 'refunded';
    if (!isLiveSeat(a)) return a.orderStatus;
    return a.checkedIn ? 'checked in' : 'not in yet';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>who's coming</Text>
        <TouchableOpacity onPress={() => { hapticLight(); router.push(`/creator/door?id=${id}` as never); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="open the door scanner">
          <ScanLine size={20} color={Colors.terracotta} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* counts, each with its own text label (§8) */}
      <View style={styles.countsRow}>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.sold}</Text>
          <Text style={styles.countL}>sold</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.checkedIn}</Text>
          <Text style={styles.countL}>checked in</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={styles.countN}>{counts.refunded}</Text>
          <Text style={styles.countL}>refunded</Text>
        </View>
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="search a name or code"
        placeholderTextColor={Colors.textLight}
        autoCorrect={false}
        accessibilityLabel="search attendees by name or reference code"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {statusChips.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, status === c.key && styles.chipOn]}
            onPress={() => { hapticLight(); setStatus(c.key); }}
            accessibilityRole="button"
            accessibilityState={{ selected: status === c.key }}
          >
            <Text style={[styles.chipText, status === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        {tiers.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, tier === t && styles.chipOn]}
            onPress={() => { hapticLight(); setTier(tier === t ? null : t); }}
            accessibilityRole="button"
            accessibilityState={{ selected: tier === t }}
          >
            <Text style={[styles.chipText, tier === t && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            /* copy to the taste gate (empty-state) */
            <Text style={styles.empty}>no one here yet.</Text>
          ) : (
            filtered.map((a) => {
              const line = seatLine(a);
              const isIn = isLiveSeat(a) && a.checkedIn;
              const isRefunded = a.refundedCents > 0 || a.voided;
              return (
                <View key={a.positionId} style={styles.row}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>{a.buyerName}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {a.referenceCode}{a.tierName ? ` · ${a.tierName}` : ''}
                    </Text>
                  </View>
                  {/* status: icon + text, never colour alone (§8) */}
                  <View style={styles.statusWrap}>
                    {isIn && <Check size={15} color={Colors.brandDeep} strokeWidth={2.5} />}
                    {isRefunded && <Ban size={14} color={Colors.textMedium} strokeWidth={2} />}
                    <Text style={[styles.statusText, isIn && styles.statusIn, isRefunded && styles.statusRefunded]}>
                      {line}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  countsRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: EventSpacing.sm, gap: EventSpacing.md },
  countCell: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 10, alignItems: 'center' },
  countN: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  countL: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium, textTransform: 'uppercase', letterSpacing: 0.5 },
  search: {
    marginHorizontal: 20, marginBottom: EventSpacing.sm,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
  },
  chipsRow: { paddingHorizontal: 20, gap: 8, paddingBottom: EventSpacing.sm },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center', marginTop: EventSpacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, letterSpacing: 0.3 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  statusIn: { color: Colors.brandDeep },
  statusRefunded: { color: Colors.textMedium },
});
