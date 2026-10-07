import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
/**
 * The community switcher (C11, doc 08 family): pills at the top of the
 * creator shell's community-scoped tabs, shown only when the creator leads
 * more than one community. Tapping a pill points every creator surface at
 * that community (they all resolve through useLedCommunity). Functionally
 * minimal per decision 15a; the design pass restyles it.
 */

import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import type { CreatorAccess } from '../../lib/creatorMode';
import { setSelectedCommunityId, useLedCommunity } from '../../lib/selectedCommunity';

interface Props {
  access: CreatorAccess | null | undefined;
}

export function CommunitySwitcher({ access }: Props) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const current = useLedCommunity(access);
  const led = access?.ledCommunities ?? [];
  if (led.length < 2) return null;
  return (
    <ScrollView
      horizontal
      style={styles.scroll}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel="switch community"
    >
      {led.map((c) => {
        const on = c.id === current?.id;
        return (
          <TouchableOpacity
            key={c.id}
            style={[styles.pill, on && styles.pillOn]}
            onPress={() => {
              if (!on) {
                hapticLight();
                setSelectedCommunityId(c.id);
              }
            }}
            accessibilityRole="tab"
            accessibilityLabel={c.name}
            accessibilityState={{ selected: on }}
            aria-selected={on}
          >
            {on && <LinearGradient
              colors={[CreatorSurfaceColors.selectionTop, CreatorSurfaceColors.selectionBottom]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}
            />}
            <View style={styles.pillContent} pointerEvents="none">
              {on && <Check size={15} strokeWidth={2} color={Colors.darkWarm} accessible={false} />}
              <Text style={styles.pillText} numberOfLines={1}>{c.name}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { gap: 8, paddingBottom: 12 },
  pill: {
    minHeight: 44,
    overflow: 'hidden',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: 220,
  },
  pillOn: { backgroundColor: Colors.parchment, borderColor: Colors.goldAccent },
  pillContent: { flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 1 },
  pillText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, flexShrink: 1 },
});
}
