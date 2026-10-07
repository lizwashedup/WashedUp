import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ScaledText as Text } from '../ScaledText';
import { SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import type { PublishedCommunityClassification } from '../../lib/communityPage';

/** Read-only creator-published labels; older communities need no placeholder. */
export function CommunityClassificationSummary({ classification }: {
  classification?: PublishedCommunityClassification | null;
}) {
  if (!classification) return null;
  const categories = classification.categories.map(value => value.charAt(0).toUpperCase() + value.slice(1)).join(' · ');
  return <View style={styles.summary}>
    <Text accessibilityLabel={`Area in LA: ${classification.discovery_area}`} style={styles.area}>{classification.discovery_area}</Text>
    <Text accessibilityLabel={`Categories: ${categories}`} style={styles.categories}>{categories}</Text>
  </View>;
}

const styles = StyleSheet.create({
  summary: { alignSelf: 'stretch', minWidth: 0, marginTop: 8, marginBottom: 4, gap: 4 },
  area: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.text, flexShrink: 1 },
  categories: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.supporting, flexShrink: 1 },
});
