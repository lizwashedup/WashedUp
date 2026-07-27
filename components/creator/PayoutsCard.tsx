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
import { Fonts, FontSizes } from '../../constants/Typography';
import { isPayoutReady, type PayoutState } from '../../lib/ticketing';

interface PayoutsCardProps {
  payout: PayoutState | undefined;
  onboardBusy: boolean;
  onOnboard: () => void;
}

export function PayoutsCard({ payout, onboardBusy, onOnboard }: PayoutsCardProps) {
  const ready = isPayoutReady(payout);
  return (
    <View style={styles.card}>
      {ready ? (
        <>
          {/* copy to the taste gate */}
          <Text style={styles.title}>payouts are set up</Text>
          <Text style={styles.meta}>
            your rate is locked at {((payout?.commissionBps ?? 0) / 100).toFixed(payout && payout.commissionBps % 100 === 0 ? 0 : 2)}% per paid ticket.
          </Text>
        </>
      ) : (
        <>
          {/* copy to the taste gate */}
          <Text style={styles.title}>
            {payout?.exists ? 'finish setting up payouts' : 'set up payouts'}
          </Text>
          <Text style={styles.meta}>
            stripe handles your bank details and identity. washedup never sees them.
          </Text>
          {payout && payout.requirementsDue.length > 0 && (
            <View style={styles.dueBox}>
              {/* copy to the taste gate: the specific asks, never a vague
                  sentence (P4). Labels come from describeStripeRequirement. */}
              <Text style={styles.dueTitle}>stripe still needs</Text>
              {payout.requirementsDue.map((label) => (
                <Text key={label} style={styles.dueItem}>· {label}</Text>
              ))}
            </View>
          )}
          {payout && payout.exists && payout.detailsSubmitted && payout.requirementsDue.length === 0 && (
            /* copy to the taste gate: submitted, capabilities not granted
               yet, nothing listed as due = Stripe is reviewing */
            <Text style={styles.meta}>everything is in. stripe is taking a last look.</Text>
          )}
          <TouchableOpacity style={styles.btn} onPress={onOnboard} activeOpacity={0.85} accessibilityRole="button">
            {onboardBusy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              /* copy to the taste gate */
              <Text style={styles.btnText}>
                {payout?.exists ? 'continue with stripe' : 'start with stripe'}
              </Text>
            )}
          </TouchableOpacity>
        </>
      )}
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
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 19 },
  dueBox: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  dueTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  dueItem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  btn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  btnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
