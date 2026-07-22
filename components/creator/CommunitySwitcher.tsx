/**
 * The community switcher (C11, doc 08 family): pills at the top of the
 * creator shell's community-scoped tabs, shown only when the creator leads
 * more than one community. Tapping a pill points every creator surface at
 * that community (they all resolve through useLedCommunity). Functionally
 * minimal per decision 15a; the design pass restyles it.
 */

import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import type { CreatorAccess } from '../../lib/creatorMode';
import { setSelectedCommunityId, useLedCommunity } from '../../lib/selectedCommunity';

interface Props {
  access: CreatorAccess | null | undefined;
}

export function CommunitySwitcher({ access }: Props) {
  const current = useLedCommunity(access);
  const led = access?.ledCommunities ?? [];
  if (led.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]} numberOfLines={1}>
              {c.name.toLowerCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingBottom: 12 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: 220,
  },
  pillOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  pillText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  pillTextOn: { color: Colors.white },
});
