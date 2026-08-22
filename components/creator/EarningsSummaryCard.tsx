/**
 * Aggregate earnings summary for the standalone "getting paid" screen
 * (inventory C-28: the per-event money summary already existed, this is its
 * total-across-every-event counterpart, the real gap that item named). Same
 * money math as the per-event view: face minus our 4% minus refunds.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import type { PayoutSummary } from '../../lib/ticketing';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={strong ? styles.rowValueStrong : styles.rowValue}>{value}</Text>
    </View>
  );
}

export function EarningsSummaryCard({ summary }: { summary: PayoutSummary }) {
  if (summary.eventsCount === 0) {
    return (
      <View style={styles.card}>
        {/* copy to the taste gate */}
        <Text style={styles.title}>nothing sold yet. once tickets move, your total lands here.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      {/* copy to the taste gate */}
      <Text style={styles.title}>
        {money(summary.netToYouCents)} across {summary.eventsCount} {summary.eventsCount === 1 ? 'event' : 'events'}.
      </Text>
      <View style={styles.rows}>
        <Row label="tickets sold" value={String(summary.ticketsSold)} />
        <Row label="ticket sales" value={money(summary.grossFaceCents)} />
        <Row label="card processing" value={money(summary.processingCents)} />
        <Row label="our 4%" value={money(summary.commissionCents)} />
        {summary.refundedCents > 0 && <Row label="refunded" value={money(summary.refundedCents)} />}
        <Row label="your total net" value={money(summary.netToYouCents)} strong />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rows: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  rowLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  rowValue: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  rowValueStrong: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
});
