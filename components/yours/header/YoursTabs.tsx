import React, { useEffect, useRef } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { ScaledText } from '../../ScaledText';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { COMMUNITIES_ENABLED, GROUPS_ENABLED } from '../../../constants/FeatureFlags';
import { COPY } from '../state/constants';

export type YoursTab = 'people' | 'myPlans' | 'circles' | 'communities' | 'albums';

/** Full-width underline tabs (active: asphalt + terracotta underline). */
export default function YoursTabs({
  active,
  onChange,
  appearance,
}: {
  appearance?: { fonts: AfterglowFontFamilies };
  active: YoursTab;
  onChange: (t: YoursTab) => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<YoursTab, number>>>({});
  useEffect(() => {
    if (positions.current[active] != null) {
      scroll.current?.scrollTo({ x: Math.max(0, positions.current[active]! - 20), animated: false });
    }
  }, [active, appearance]);
  // Keep every enabled section reachable at phone widths and larger text sizes.
  const tabs: ReadonlyArray<readonly [YoursTab, string]> = [
    ['myPlans', COPY.tabMyPlans],
    ['people', COPY.tabPeople],
    ...(GROUPS_ENABLED
      ? ([['circles', COPY.tabCircles]] as const)
      : []),
    // Communities sits between Circles and Albums (Liz's walkthrough order);
    // compile-time flag, so the shipped row is unchanged when off.
    ...(COMMUNITIES_ENABLED
      ? ([['communities', COPY.tabCommunities]] as const)
      : []),
    ['albums', COPY.tabAlbums],
  ];

  const items = tabs.map(([key, label]) => {
    const on = active === key;
    return (
      <Pressable key={key} onPress={() => onChange(key)}
        onLayout={event => {
          positions.current[key] = event.nativeEvent.layout.x;
          if (on) scroll.current?.scrollTo({ x: Math.max(0, event.nativeEvent.layout.x - 20), animated: false });
        }}
        style={[styles.tab, appearance && styles.reviewTab]}
        accessibilityRole="tab" accessibilityState={{ selected: on }}>
        <ScaledText numberOfLines={1} style={[styles.label, on && styles.labelOn, appearance && {
          ...AfterglowType.message, fontFamily: on ? appearance.fonts.semibold : appearance.fonts.medium,
          color: on ? AfterglowColors.ink : AfterglowColors.muted,
        }]}>{label}</ScaledText>
        {on && <View style={[styles.underline, appearance && styles.reviewUnderline]} />}
      </Pressable>
    );
  });
  return (
    <ScrollView ref={scroll} horizontal style={styles.reviewScroll} showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" contentContainerStyle={appearance ? styles.reviewRow : styles.row}>
      {items}
    </ScrollView>
  );

}

const styles = StyleSheet.create({
  reviewScroll: { flexGrow: 0, flexShrink: 0 },
  reviewRow: { paddingHorizontal: 20, gap: 22, borderBottomWidth: 1, borderBottomColor: AfterglowColors.subtleLine },
  reviewTab: { marginRight: 0, minHeight: 48, paddingTop: 10, paddingBottom: 12, flexShrink: 0 },
  reviewUnderline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, marginTop: 0, borderRadius: 0, backgroundColor: AfterglowColors.clay },
  row: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 4 },
  tab: { marginRight: 24, paddingVertical: 8, minHeight: 44, justifyContent: 'center', flexShrink: 0 },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  labelOn: { color: Colors.asphalt, fontFamily: Fonts.sansBold },
  underline: {
    height: 2.5,
    backgroundColor: Colors.terracotta,
    borderRadius: 2,
    marginTop: 6,
  },
});
