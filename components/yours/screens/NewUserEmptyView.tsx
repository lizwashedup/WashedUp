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

/** Brand-new user. Not a dead end: copy + nearby plans + invite. */
export default function NewUserEmptyView({ onInvite }: { onInvite: () => void }) {
  const { data: nearby, isLoading } = useNearbyPlans(true);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.ghostTop}>
        <ShimmerGrid count={3} />
      </View>
      <Text style={styles.title}>{COPY.emptyTitle}</Text>
      <Text style={styles.sub}>{COPY.emptySub}</Text>
      <View style={styles.ghostMid}>
        <ShimmerGrid count={6} />
      </View>

      <Text style={styles.section}>{COPY.nearbyHeader}</Text>
      {isLoading ? (
        <ActivityIndicator color={Colors.terracotta} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {(nearby ?? []).map((p) => (
            <NearbyPlanCard key={p.id} plan={p} />
          ))}
        </ScrollView>
      )}

      <InviteCard onPress={onInvite} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 16 },
  ghostTop: { opacity: 0.6 },
  ghostMid: { opacity: 0.5, marginVertical: 8 },
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
    marginTop: 16,
    marginBottom: 12,
  },
  cards: { paddingHorizontal: 16 },
});
