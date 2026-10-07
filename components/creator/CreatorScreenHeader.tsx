import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { ScaledText } from '../ScaledText';
import ProfileButton from '../ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';

/** The creator header without changing the screen's scroll, form or navigation ownership. */
export function CreatorScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <View style={styles.header}>
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}>
      <ArrowLeft size={20} color={C.ink} />
    </Pressable>}
    <ScaledText numberOfLines={2} style={[styles.title, { fontFamily: fonts.medium }]}>{title}</ScaledText>
    <ProfileButton compact />
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 56 },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { ...T.body, color: C.ink, flex: 1, minWidth: 0 },
});
