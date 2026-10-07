import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export function ChatMessageAnchorNotice({ loading, unavailable, failed, onLatest, fonts }: {
  loading: boolean; unavailable: boolean; failed?: boolean; onLatest: () => void; fonts?: { regular: string; medium: string };
}) {
  return <View style={styles.row}>
    {loading && <ActivityIndicator size="small" color={Colors.terracotta} />}
    <Text style={[styles.label, fonts && { fontFamily: fonts.regular }]} accessibilityLiveRegion="polite">{unavailable ? 'This message is no longer available.' : loading ? 'Finding your message…' : failed ? 'Message not loaded' : 'Opened from a reaction'}</Text>
    <TouchableOpacity onPress={onLatest} style={styles.action} accessibilityRole="button" accessibilityLabel="Return to latest messages">
      <Text style={[styles.actionText, fonts && { fontFamily: fonts.medium }]}>Latest</Text>
    </TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 44, backgroundColor: Colors.goldBadgeSoft },
  label: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.asphalt, paddingVertical: 8 },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
