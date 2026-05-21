import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ShimmerGrid from '../primitives/ShimmerGrid';
import NearbyPlanCard from '../nearby/NearbyPlanCard';
import InviteCard from '../nearby/InviteCard';
import { COPY } from '../state/constants';
import { useNearbyPlans } from '../../../hooks/useNearbyPlans';

/**
 * Brand-new user. Not a dead end. Per spec the shimmer is a SINGLE 9-circle
 * 3x3 grid behind everything (not two stacked grids), with welcome copy +
 * nearby plans + invite card laid out over the top. The shimmer wrapper is
 * pointerEvents="none" so it can never eat touches on the content above.
 */
export default function NewUserEmptyView({ onInvite }: { onInvite: () => void }) {
  const { data: nearby, isLoading } = useNearbyPlans(true);

  return (
    <View style={styles.wrap}>
      {/* Background: single 9-circle 3x3 ghost grid. Touch-transparent. */}
      <View style={styles.shimmer} pointerEvents="none">
        <ShimmerGrid count={9} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{COPY.emptyTitle}</Text>
        <Text style={styles.sub}>{COPY.emptySub}</Text>

        <Text style={styles.section}>{COPY.nearbyHeader}</Text>
        {isLoading ? (
          <ActivityIndicator color={Colors.terracotta} />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cards}
            keyboardShouldPersistTaps="handled"
          >
            {(nearby ?? []).map((p) => (
              <NearbyPlanCard key={p.id} plan={p} />
            ))}
          </ScrollView>
        )}

        <InviteCard onPress={onInvite} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  shimmer: {
    position: 'absolute',
    top: 24,
    left: 0,
    right: 0,
    opacity: 0.55,
  },
  content: { paddingTop: 32, paddingBottom: 32 },
  title: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 16,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.secondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 8,
  },
  section: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginTop: 32,
    marginBottom: 12,
  },
  cards: { paddingHorizontal: 16 },
});
