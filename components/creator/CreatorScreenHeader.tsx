import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { ScaledText } from '../ScaledText';
import ProfileButton from '../ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';

/** The creator header without changing the screen's scroll, form or navigation ownership. */
export function CreatorScreenHeader({ title, onBack, backLabel = 'Back' }: { title: string; onBack?: () => void; backLabel?: string }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.2;
  return <View style={styles.header}>
    <View style={styles.controls}>
      {onBack && <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.back}>
        <ArrowLeft size={20} color={C.ink} />
      </Pressable>}
      {stacked ? <View style={styles.spacer} /> : <ScaledText accessibilityRole="header" numberOfLines={2} style={[styles.title, { fontFamily: fonts.medium }]}>{title}</ScaledText>}
      <ProfileButton compact />
    </View>
    {stacked && <ScaledText accessibilityRole="header" style={[styles.expandedTitle, { fontFamily: fonts.medium }]}>{title}</ScaledText>}
  </View>;
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  spacer: { flex: 1 },
  expandedTitle: { ...T.body, color: C.ink, paddingHorizontal: 8, paddingBottom: 8 },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { ...T.body, color: C.ink, flex: 1, minWidth: 0 },
});
