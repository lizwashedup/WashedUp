import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import type { RequestAppearance } from './RequestStack';

const AUTO_DISMISS_MS = 4000;
export type BlockPromptProps = { name: string; onBlock: () => void; onKeep: () => void; pending?: boolean; error?: string; appearance?: RequestAppearance };
/** Offered only after confirmed soft decline. The existing optional prompt
 * legacy timer pauses during a write or failure. The staged choice remains
 * available until explicitly dismissed; it is not a timed reading task. */
export default function BlockPrompt({ name, onBlock, onKeep, pending = false, error, appearance }: BlockPromptProps) {
  const keep = useRef(onKeep); keep.current = onKeep;
  useEffect(() => {
    if (appearance || pending || error) return;
    const timer = setTimeout(() => keep.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [name, pending, error, !!appearance]);
  const s = useMemo(() => appearance ? { ...styles, ...blockAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{COPY.blockPromptTitle(name)}</Text>
      {appearance && <Text style={s.body}>The request was declined. Blocking also prevents new connection requests from this person.</Text>}
      {(pending || error) && <Text style={s.feedback} accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite">{pending ? 'Blocking…' : error}</Text>}
      <View style={s.row}>
        <Pressable style={[s.block, pending && s.disabled]} onPress={onBlock} disabled={pending} accessibilityRole="button" accessibilityLabel={error ? `Try again to block ${name}` : `Block ${name}`} accessibilityState={{ disabled: pending, busy: pending }}>
          <Text numberOfLines={1} style={s.blockText}>{error ? 'Try again' : COPY.blockPromptBlock}</Text>
        </Pressable>
        <Pressable style={[s.keep, pending && s.disabled]} onPress={onKeep} disabled={pending} accessibilityRole="button" accessibilityLabel={appearance ? "No thanks, skip blocking" : "Skip blocking"} accessibilityState={{ disabled: pending }}>
          <Text numberOfLines={1} style={s.keepText}>{appearance ? 'No thanks' : COPY.blockPromptKeep}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  feedback: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  disabled: { opacity: 0.55 },
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    gap: 12,
  },
  title: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: 12 },
  block: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
  },
  blockText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  keep: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: Colors.terracotta,
  },
  keepText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});

function blockAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    wrap: { backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 4, padding: 18, marginHorizontal: 20, gap: 14 },
    title: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    body: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    feedback: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
    block: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 4, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    blockText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    keep: { flex: 1, minHeight: 44, borderRadius: 4, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: AfterglowColors.clay },
    keepText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
  });
}
