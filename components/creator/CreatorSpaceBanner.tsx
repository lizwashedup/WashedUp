import { GoldSurfaceFill } from './GoldSurfaceFill';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
/**
 * The approved organizer's front door (7-21 order: the entry must be
 * impossible to miss). Renders ONLY for a signed-in account with an
 * approved operator grant; everyone else gets nothing, flag state
 * irrelevant either way. Public dark holds: the grant is the gate.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticMedium } from '../../lib/haptics';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import {
  creatorLandingRoute,
  getCreatorAccess,
  hasCreatorAccess,
  type CreatorAccess,
} from '../../lib/creatorMode';

export function CreatorSpaceBanner() {
  const {fonts} = useAfterglowFonts(true,'creator');
  const [access, setAccess] = useState<CreatorAccess | null>(null);

  useEffect(() => {
    getCreatorAccess()
      .then((a) => setAccess(hasCreatorAccess(a) ? a : null))
      .catch(() => setAccess(null));
  }, []);

  if (!access) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        hapticMedium();
        if (CREATOR_PAGES_ENABLED) router.push('/creator/pages');
        else router.replace(creatorLandingRoute(access));
      }}
      accessibilityRole="button"
      accessibilityLabel="Open your creator pages"
      activeOpacity={0.85}
    >
      <GoldSurfaceFill radius={16} /><View style={styles.body}>
        {/* copy to the taste gate */}
        <Text style={[styles.title,{fontFamily:fonts.medium}]}>your creator space is ready</Text>
        <Text style={[styles.meta,{fontFamily:fonts.regular}]}>events, tickets, your page. it all lives here.</Text>
      </View>
      <View><ChevronRight size={18} color={Colors.asphalt} strokeWidth={2.5} /></View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 0,
    borderColor: Colors.terracotta,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
