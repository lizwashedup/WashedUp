/**
 * Per-event money breakdown for the organizer (parity gap O-06). Mirrors
 * web's src/components/communities/creator/MoneySummaryCard.tsx one-for-one
 * -- same headline logic, same row set, same net formula.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { formatCents } from '../../lib/ticketing';
import type { EventMoneySummary } from '../../lib/ticketAttendees';

interface MoneySummaryCardProps {
  money: EventMoneySummary;
  ticketsSold: number;
  refundedCents: number;
}

function day(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

export function computeNetToYouCents(m: EventMoneySummary, refundedCents: number): number {
  // first-order net: face minus our 4% minus refunds. Mirrors web's own
  // explicitly-held §6 formula. refundedCents MUST be scoped to positions on
  // still-'paid' orders (sumRefundedCentsOnPaidOrders in lib/ticketAttendees):
  // getEventMoneySummary already drops fully-refunded orders from gross AND
  // commission, so an unscoped refund total double-subtracted full refunds
  // (fixed 2026-08-25). Commission on a PARTIALLY refunded order is still
  // charged in full here -- that treatment is the unresolved §6 product
  // question (Liz's call), deliberately unchanged.
  return m.grossFaceCents - m.commissionCents - refundedCents;
}

export function headline(m: EventMoneySummary, netToYouCents: number): string {
  /* copy to the taste gate -- mirrors web's proposed LIZ COPY verbatim */
  if (m.payoutPaidAt) return `paid out ${day(m.payoutPaidAt)}. ${formatCents(netToYouCents)} is yours and settled.`;
  if (m.payoutStatus === 'released' || m.payoutReleasedAt)
    return `your payout of ${formatCents(netToYouCents)} released ${day(m.payoutReleasedAt)} and is on its way to your bank.`;
  if (m.payoutStatus === 'failed')
    return 'a payout did not go through. we are on it; nothing is lost.';
  return `you'll receive ${formatCents(netToYouCents)} after the event wraps, once payouts release.`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={strong ? styles.rowValueStrong : styles.rowValue}>{value}</Text>
    </View>
  );
}

export function MoneySummaryCard({ money, ticketsSold, refundedCents }: MoneySummaryCardProps) {
  const netToYouCents = computeNetToYouCents(money, refundedCents);
  return (
    <View style={styles.card} accessibilityLabel="money summary">
      <Text style={styles.headline}>{headline(money, netToYouCents)}</Text>
      <View style={styles.rows}>
        <Row label="tickets sold" value={String(ticketsSold)} />
        <Row label="ticket sales" value={formatCents(money.grossFaceCents)} />
        <Row label="card processing" value={formatCents(money.processingCents)} />
        <Row label="our 4%" value={formatCents(money.commissionCents)} />
        {refundedCents > 0 && <Row label="refunded" value={formatCents(refundedCents)} />}
        <Row label="your net" value={formatCents(netToYouCents)} strong />
      </View>
      {money.payoutStatus && (
        <Text style={styles.footer}>
          payout status: {money.payoutStatus.replace(/_/g, ' ')}
          {money.payoutReleasedAt ? ` · released ${day(money.payoutReleasedAt)}` : ''}
          {money.payoutPaidAt ? ` · paid ${day(money.payoutPaidAt)}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 16, marginHorizontal: 20, marginBottom: 12, gap: 4,
  },
  headline: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt, lineHeight: 20 },
  rows: { marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.inputBg, paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.inputBg },
  rowLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  rowValue: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  rowValueStrong: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  footer: { marginTop: 4, fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textMedium },
});
