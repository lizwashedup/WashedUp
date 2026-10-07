/**
 * Aggregate earnings summary for the standalone "getting paid" screen
 * (inventory C-28: the per-event money summary already existed, this is its
 * total-across-every-event counterpart, the real gap that item named). Same
 * money math as the per-event view: face minus our 4% minus refunds.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import type { PayoutSummary } from '../../lib/ticketing';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Row({ label, value, strong, fonts }: { label: string; value: string; strong?: boolean; fonts?: AfterglowFontFamilies }) {
  const styles = makeStyles(fonts);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{fonts ? label.charAt(0).toUpperCase() + label.slice(1) : label}</Text>
      <Text style={strong ? styles.rowValueStrong : styles.rowValue}>{value}</Text>
    </View>
  );
}

export function EarningsSummaryCard({ summary, appearance }: { summary: PayoutSummary; appearance?: {fonts: AfterglowFontFamilies} }) {
  const styles = makeStyles(appearance?.fonts);
  if (summary.eventsCount === 0) {
    return (
      <View style={styles.card}>
        {/* copy to the taste gate */}
        <Text style={styles.title}>{appearance ? 'Nothing sold yet. Once tickets move, your total lands here.' : 'nothing sold yet. once tickets move, your total lands here.'}</Text>
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
        <Row fonts={appearance?.fonts} label="tickets sold" value={String(summary.ticketsSold)} />
        <Row fonts={appearance?.fonts} label="ticket sales" value={money(summary.grossFaceCents)} />
        <Row fonts={appearance?.fonts} label="card processing" value={money(summary.processingCents)} />
        <Row fonts={appearance?.fonts} label="our 4%" value={money(summary.commissionCents)} />
        {summary.refundedCents > 0 && <Row fonts={appearance?.fonts} label="refunded" value={money(summary.refundedCents)} />}
        <Row fonts={appearance?.fonts} label="your total net" value={money(summary.netToYouCents)} strong />
      </View>
    </View>
  );
}

const makeStyles = (fonts?: AfterglowFontFamilies) => StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  title: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rows: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  rowLabel: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  rowValue: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  rowValueStrong: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
});
