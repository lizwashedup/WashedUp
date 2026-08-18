/**
 * C3 - your tickets (doc 79 C3). The buyer's confirmed orders; a ticket reads
 * as arrival, not a receipt. Animated QR is a later polish, not launch-blocking
 * (doc 78 §4).
 *
 * Each SEAT is the ticket: the door checks ticket_order_positions.reference_code
 * (record_ticket_checkin), so that code (never an order-id prefix) is what a
 * seat shows, as a QR the door scanner reads plus the same code in text for the
 * type-a-code path. A voided seat (partial refund) keeps its place in the list
 * but loses its QR, so nobody walks up with a dead code.
 *
 * Scene design spec item 05 (creator-branded ticketing, launch priority per
 * Liz): every card carries the event's own image + creator byline ("put on
 * by X"), and the empty state is a real invitation with a CTA rather than a
 * bare sentence - this repo's own CLAUDE.md already bans a bare "no X yet"
 * with nothing tappable, and the old copy here was exactly that.
 */

import React from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeft, Ticket, Compass } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { formatEventDateLA } from '../../lib/laDate';
import { getOrganizerProfiles } from '../../lib/organizerProfile';
import {
  REFUND_DISCLOSURE, executeRefund, formatCents, getConfirmationMessage,
  getMyOrders, previewRefund,
  type MyOrder, type MySeat,
} from '../../lib/ticketing';

/**
 * doc 111: the organizer's "after they buy" note stays on the tickets, the
 * documented gold-border quote treatment (the organizer speaking, no new
 * accents). Renders nothing until SQL-96's column lands (self-flipping read).
 */
function OrganizerNote({ eventId }: { eventId: string }) {
  const { data: note } = useQuery({
    queryKey: ['confirmation-message', eventId],
    queryFn: () => getConfirmationMessage(eventId),
    staleTime: 60_000,
  });
  if (!note) return null;
  return (
    <View style={styles.organizerNote}>
      {/* copy to the taste gate */}
      <Text style={styles.organizerNoteLabel}>from the organizer</Text>
      <Text style={styles.organizerNoteText}>{note}</Text>
    </View>
  );
}

// the scanner reads from arm's length in door light; smaller and a 10-char
// code still scans, but this size is comfortable on every supported width
const QR_SIZE = 168;
// quiet zone is part of the QR spec: scanners need clear margin around the marks
const QR_QUIET_ZONE = 12;

function SeatTicket({ seat, qty }: { seat: MySeat; qty: number }) {
  if (seat.voided) {
    return (
      <View style={styles.seat}>
        {qty > 1 && (
          /* copy to the taste gate: per-seat label */
          <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
        )}
        <Text style={styles.seatCodeVoided}>{seat.reference_code}</Text>
        {/* copy to the taste gate */}
        <Text style={styles.seatVoidedNote}>this one was refunded and won't scan</Text>
      </View>
    );
  }
  return (
    <View style={styles.seat}>
      {qty > 1 && (
        /* copy to the taste gate: per-seat label */
        <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
      )}
      <View
        style={styles.qrWrap}
        accessible
        accessibilityLabel={`ticket code ${seat.reference_code}`}
      >
        <QRCode
          value={seat.reference_code}
          size={QR_SIZE}
          quietZone={QR_QUIET_ZONE}
          color={Colors.asphalt}
          backgroundColor={Colors.white}
        />
      </View>
      <Text style={styles.seatCode}>{seat.reference_code}</Text>
    </View>
  );
}

/**
 * Buyer self-refund (doc 108; web wallet f370d4b is the lockstep reference).
 * The affordance renders ONLY from the server's preview answer
 * (can_buyer_self_refund is the §5 preset gate); the client never decides
 * eligibility. The refund call itself sends no kind and no seats: the fn
 * forces buyer_request on the whole remaining order and re-checks the gate.
 */
function OrderRefund({ order }: { order: MyOrder }) {
  const queryClient = useQueryClient();
  const { data: preview } = useQuery({
    queryKey: ['ticket-refund-preview', order.id],
    queryFn: () => previewRefund(order.id),
    staleTime: 30_000,
  });

  const refund = useMutation({
    mutationFn: () => executeRefund(order.id),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        queryClient.invalidateQueries({ queryKey: ['my-ticket-orders'] });
        queryClient.invalidateQueries({ queryKey: ['ticket-refund-preview', order.id] });
        /* LIZ COPY (web's shipped strings, mirrored): pending is still success */
        Alert.alert(
          'refund on its way',
          outcome.pending
            ? 'your refund is on its way. it can take a minute to show here.'
            : 'refunded. it lands back on your card in a few days.',
        );
      } else {
        Alert.alert('about that refund', outcome.message);
      }
    },
  });

  if (!preview?.allowed || !preview.canSelfRefund) return null;

  const confirmRefund = () => {
    Alert.alert(
      /* LIZ COPY (web's confirm line, mirrored) */
      `refund ${formatCents(preview.refundAmountCents)} to your card?`,
      REFUND_DISCLOSURE,
      [
        { text: 'keep my tickets', style: 'cancel' },
        { text: 'yes, refund it', style: 'destructive', onPress: () => refund.mutate() },
      ],
    );
  };

  return (
    <View style={styles.refundBlock}>
      {/* §5 disclosure: LIZ COPY RULED verbatim, never reworded */}
      <Text style={styles.refundDisclosure}>{REFUND_DISCLOSURE}</Text>
      <TouchableOpacity
        style={styles.refundButton}
        onPress={confirmRefund}
        disabled={refund.isPending}
        accessibilityRole="button"
        accessibilityLabel="refund this order"
      >
        {refund.isPending ? (
          <ActivityIndicator size="small" color={EventAction.secondaryLabel} />
        ) : (
          /* LIZ COPY (web's trigger label, mirrored) */
          <Text style={styles.refundButtonText}>refund this order</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Scene spec 05: no bare "no tickets yet" - an invitation with a CTA,
 *  matching this repo's own documented empty-state rule (and the exact
 *  shape components/yours/circles/CirclesEmptyState.tsx already uses). */
function TicketsEmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconBubble}>
        <Compass size={28} color={Colors.terracotta} strokeWidth={1.5} />
      </View>
      {/* copy to the taste gate */}
      <Text style={styles.emptyTitle}>no tickets yet</Text>
      {/* copy to the taste gate */}
      <Text style={styles.emptySub}>when you get one, it lives here. see what's happening tonight.</Text>
      <TouchableOpacity
        style={styles.emptyCta}
        onPress={() => router.push('/(tabs)/explore' as never)}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {/* copy to the taste gate: 2 words, won't wrap (button-label rule) */}
        <Text style={styles.emptyCtaText}>find plans</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function YourTicketsScreen() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['my-ticket-orders'],
    queryFn: getMyOrders,
    staleTime: 15_000,
  });

  // Scene spec 05: creator identity per card. Batch-resolved ONCE for the
  // whole list (one query, not one per card) via the same public_name-wins,
  // else-organizer-profile rule the confirmation screen uses. Deliberately
  // not the event page's fuller community-leader-face branch - see the
  // scratchpad plan for why that's a named scope cut, not a silent guess.
  const hostIds = [...new Set((orders ?? [])
    .filter((o) => !o.event_public_name && !!o.event_host_user_id)
    .map((o) => o.event_host_user_id as string))];
  const { data: organizerProfiles } = useQuery({
    queryKey: ['organizer-profiles-wallet', hostIds.join(',')],
    queryFn: () => getOrganizerProfiles(hostIds),
    enabled: hostIds.length > 0,
    staleTime: 60_000,
  });

  const bylineFor = (o: MyOrder): { name: string | null; logo: string | null } => {
    if (o.event_public_name) return { name: o.event_public_name, logo: null };
    const p = o.event_host_user_id ? organizerProfiles?.get(o.event_host_user_id) : undefined;
    return { name: p?.display_name ?? null, logo: p?.logo_url ?? null };
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>your tickets</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
        ) : !orders || orders.length === 0 ? (
          <TicketsEmptyState />
        ) : (
          orders.map((o) => {
            const byline = bylineFor(o);
            return (
              <View key={o.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  {o.event_image ? (
                    <Image source={{ uri: o.event_image }} style={styles.cardImage} contentFit="cover" />
                  ) : (
                    <View style={styles.cardIcon}>
                      <Ticket size={20} color={EventAction.primary} strokeWidth={2} />
                    </View>
                  )}
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{o.event_title ?? 'your event'}</Text>
                    {!!o.event_date && (
                      <Text style={styles.cardMeta}>{formatEventDateLA(o.event_date)}</Text>
                    )}
                    <Text style={styles.cardMeta}>
                      {o.qty} {o.qty === 1 ? 'ticket' : 'tickets'} · {o.total_cents === 0 ? 'free' : formatCents(o.total_cents)}
                    </Text>
                    {!!byline.name && (
                      <View style={styles.cardCreatorRow}>
                        {!!byline.logo && (
                          <Image source={{ uri: byline.logo }} style={styles.cardCreatorAvatar} contentFit="cover" />
                        )}
                        {/* LIZ COPY (decision 16): bylines say put on by, never hosted by */}
                        <Text style={styles.cardCreatorText} numberOfLines={1}>put on by {byline.name}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <OrganizerNote eventId={o.event_id} />
                {o.seats.map((seat) => (
                  <SeatTicket key={seat.id} seat={seat} qty={o.qty} />
                ))}
                <OrderRefund order={o} />
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  content: { padding: 20, gap: EventSpacing.md, flexGrow: 1 },
  loading: { marginTop: EventSpacing.xl },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  emptyIconBubble: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.emptyIconBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: EventSpacing.md,
  },
  emptyTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm, textAlign: 'center' },
  emptySub: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary,
    textAlign: 'center', marginTop: 8, marginBottom: EventSpacing.lg,
  },
  emptyCta: {
    minHeight: 44, paddingHorizontal: 24, borderRadius: 999, backgroundColor: Colors.terracotta,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  emptyCtaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  card: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: EventSpacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardImage: { width: 44, height: 44, borderRadius: 12 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  cardCreatorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardCreatorAvatar: { width: 14, height: 14, borderRadius: 7 },
  cardCreatorText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary },
  seat: {
    alignItems: 'center', gap: EventSpacing.xs,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  seatLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  qrWrap: { borderRadius: 12, overflow: 'hidden' },
  seatCode: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, letterSpacing: 3,
  },
  seatCodeVoided: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.textLight,
    letterSpacing: 3, textDecorationLine: 'line-through',
  },
  seatVoidedNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  organizerNote: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 12, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.quoteText, lineHeight: 19 },
  refundBlock: {
    alignItems: 'center', gap: EventSpacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  refundDisclosure: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium,
    textAlign: 'center', paddingHorizontal: EventSpacing.sm,
  },
  refundButton: {
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: EventAction.secondaryBorder,
    paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
  },
  refundButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.secondaryLabel },
});
