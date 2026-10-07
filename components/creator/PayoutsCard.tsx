/**
 * The payouts card (doc 61 §2: Stripe Express hosts everything), shared by
 * the per-event tickets screen and the standalone getting-paid front door
 * (7-27 ship ruling item 4, mirroring web's PayoutsCard). Three states:
 * ready (both capabilities), almost there (account exists, stripe still
 * needs something: the requirements_due list plus the resume button), and
 * not started (the setup pitch + button). Presentational: the owner loads
 * the account and drives onboarding.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import {PageAction} from './pages/PageFrame';
import { isPayoutReady, type PayoutState } from '../../lib/ticketing';

interface PayoutsCardProps {
  payout: PayoutState | undefined;
  appearance?: {fonts: AfterglowFontFamilies};
  compact?: boolean;
  onboardBusy: boolean;
  onOnboard: () => void;
}

export function PayoutsCard({ payout, onboardBusy, onOnboard, compact = false, appearance }: PayoutsCardProps) {
  const styles = makeStyles(appearance?.fonts);
  const copy = (text: string) => appearance ? text.charAt(0).toUpperCase() + text.slice(1).replace(/stripe/g, 'Stripe').replace(/washedup/g, 'WashedUp') : text;
  // An undefined payout means React Query has not finished the first read.
  // Never turn "still loading" into the false "set up payouts" state Liz
  // saw flash before her real ready state appeared.
  if (payout === undefined) {
    return (
      <View style={[styles.card, compact && styles.compact]} accessibilityLabel="checking payout setup">
        <Text style={styles.title}>{copy('checking payout setup')}</Text>
        <ActivityIndicator size="small" color={Colors.terracotta} />
      </View>
    );
  }

  const ready = isPayoutReady(payout);
  return (
    <View style={[styles.card, compact && styles.compact]}>
      {ready ? (
        <>
          {/* copy to the taste gate */}
          <Text style={styles.title}>{copy('payouts are set up')}</Text>
          <Text style={styles.meta}>
            {appearance ? 'Your' : 'your'} rate is locked at {((payout?.commissionBps ?? 0) / 100).toFixed(payout && payout.commissionBps % 100 === 0 ? 0 : 2)}% per paid ticket.
          </Text>
        </>
      ) : (
        <>
          {/* copy to the taste gate */}
          <Text style={styles.title}>
            {copy(payout?.exists ? 'finish setting up payouts' : 'set up payouts')}
          </Text>
          <Text style={styles.meta}>
            {copy(compact ? 'For paid tickets. Stripe handles bank details and identity.' : 'stripe handles your bank details and identity. washedup never sees them.')}
          </Text>
          {payout && payout.requirementsDue.length > 0 && (
            <View style={styles.dueBox}>
              {/* copy to the taste gate: the specific asks, never a vague
                  sentence (P4). Labels come from describeStripeRequirement. */}
              <Text style={styles.dueTitle}>{copy('stripe still needs')}</Text>
              {payout.requirementsDue.map((label) => (
                <Text key={label} style={styles.dueItem}>· {label}</Text>
              ))}
            </View>
          )}
          {payout && payout.exists && payout.detailsSubmitted && payout.requirementsDue.length === 0 && (
            /* copy to the taste gate: submitted, capabilities not granted
               yet, nothing listed as due = Stripe is reviewing */
            <Text style={styles.meta}>{copy('everything is in. stripe is taking a last look.')}</Text>
          )}
          {appearance ? <PageAction primary compact={compact} title={onboardBusy ? 'Opening…' : payout?.exists ? 'Continue with Stripe' : 'Start with Stripe'} disabled={onboardBusy} onPress={onOnboard}/> : <TouchableOpacity style={[styles.btn, compact && styles.compactBtn]} onPress={onOnboard} disabled={onboardBusy} accessibilityState={{disabled:onboardBusy}} activeOpacity={0.85} accessibilityRole="button">
            {onboardBusy ? (
              <ActivityIndicator size="small" color={compact ? Colors.terracotta : Colors.white} />
            ) : (
              /* copy to the taste gate */
              <Text style={[styles.btnText, compact && styles.compactBtnText]}>
                {payout?.exists ? 'continue with stripe' : 'start with stripe'}
              </Text>
            )}
          </TouchableOpacity>}
        </>
      )}
    </View>
  );
}

const makeStyles = (fonts?: AfterglowFontFamilies) => StyleSheet.create({
  compact: { backgroundColor: 'transparent', borderWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 0, paddingHorizontal: 0, paddingVertical: 14, marginTop: 10, gap: 4 },
  compactBtn: { backgroundColor: 'transparent', alignSelf: 'flex-start', minHeight: 44, paddingVertical: 10, marginTop: 0 },
  compactBtnText: { color: Colors.terracotta },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  title: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  meta: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  dueBox: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  dueTitle: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  dueItem: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  btn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  btnText: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
