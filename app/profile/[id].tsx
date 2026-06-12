import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, Redirect } from 'expo-router';
import Colors from '../../constants/Colors';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';
import { useAuthUserId } from '../../components/yours/state/useAuthUserId';
import PersonProfilePage from '../../components/yours/profile/PersonProfilePage';

/**
 * The individual profile page route ("just {name}"), distinct from the keep
 * page at /person/[id] (the shared "you & {name}" story). Reached from the
 * People long-press "View profile" row. Gated by YOURS_PAGE_ENABLED (the whole
 * Yours surface is); redirects out when off so the route can't be deep-linked
 * into a shipped build. Mutual-gating lives in the get_person_profile RPC.
 */
export default function ProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: userId, isLoading } = useAuthUserId();

  if (!YOURS_PAGE_ENABLED) {
    return <Redirect href="/(tabs)/friends" />;
  }

  if (isLoading || !userId || !id) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.terracotta} />
      </View>
    );
  }

  return <PersonProfilePage userId={userId} targetId={id} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cream,
  },
});
