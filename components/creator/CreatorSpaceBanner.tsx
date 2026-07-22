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
import {
  creatorLandingRoute,
  getCreatorAccess,
  hasCreatorAccess,
  type CreatorAccess,
} from '../../lib/creatorMode';

export function CreatorSpaceBanner() {
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
        router.replace(creatorLandingRoute(access));
      }}
      activeOpacity={0.85}
    >
      <View style={styles.body}>
        {/* copy to the taste gate */}
        <Text style={styles.title}>your creator space is ready</Text>
        <Text style={styles.meta}>events, tickets, your page. it all lives here.</Text>
      </View>
      <ChevronRight size={18} color={Colors.terracotta} strokeWidth={2.5} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
