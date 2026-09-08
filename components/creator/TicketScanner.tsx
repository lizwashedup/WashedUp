/**
 * Build-27-safe fallback for door mode. The App Store binary does not contain
 * expo-camera, so its OTA keeps manual ticket-code entry and does not import a
 * native module that the installed binary cannot load.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';

interface TicketScannerProps {
  /** fired with the raw scanned string; the parent normalizes + checks in */
  onScan: (raw: string) => void;
  /** while a check-in is in flight, the parent pauses scanning */
  busy: boolean;
}

export default function TicketScanner(_props: TicketScannerProps) {
  return (
    <View style={styles.permWrap}>
      <Text style={styles.permText}>camera scanning arrives with the next app update. type the ticket code instead.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  permWrap: { alignItems: 'center', gap: EventSpacing.md, paddingHorizontal: 20 },
  permText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
});
