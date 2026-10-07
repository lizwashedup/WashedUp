import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { formatCents } from '../../lib/ticketing';
import type { PurchasedExtra } from '../../lib/purchaseExtras';

export function PurchaseExtras({ extras, shared = false }: { extras: PurchasedExtra[]; shared?: boolean }) {
  if (!extras.length) return null;
  return <View style={[styles.section, !shared && styles.receipt]}>
    <Text accessibilityRole="header" style={styles.heading}>{shared ? 'Extras for this purchase' : 'Extras'}</Text>
    {extras.map(extra => <View key={extra.id} style={styles.row}>
      <View style={styles.description}>
        <Text style={styles.name}>{extra.quantity} × {extra.name}</Text>
        {!!extra.optionLabel && <Text style={styles.option}>{extra.optionLabel}</Text>}
      </View>
      {!shared && <Text style={styles.price}>{extra.unitPriceCents === 0 ? 'Free' : formatCents(extra.quantity * extra.unitPriceCents)}</Text>}
    </View>)}
  </View>;
}

export function PurchaseExtrasNotice({ error, loading, onRetry }: { error?: string; loading?: boolean; onRetry: () => void }) {
  if (!error && !loading) return null;
  return <View style={styles.notice}>
    {loading && <ActivityIndicator size="small" color={Colors.terracotta} />}
    <Text accessibilityRole={error ? 'alert' : undefined} style={styles.noticeText}>{error ? 'Extras couldn’t be loaded.' : 'Loading extras…'}</Text>
    {!!error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry purchase extras" style={styles.retry} disabled={loading} onPress={onRetry}>
      <Text style={styles.retryText}>Try again</Text>
    </TouchableOpacity>}
  </View>;
}
const styles = StyleSheet.create({
  receipt: { marginTop: 16 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: 12, gap: 10 },
  heading: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  description: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt, lineHeight: 20 },
  option: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, lineHeight: 18 },
  price: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt, lineHeight: 20, flexShrink: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  noticeText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, flex: 1, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
