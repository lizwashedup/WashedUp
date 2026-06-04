import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, Redirect } from 'expo-router';
import Colors from '../../constants/Colors';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';
import { useAuthUserId } from '../../components/yours/state/useAuthUserId';
import KeepPage from '../../components/yours/keep/KeepPage';

/**
 * The "you & [name]" keep page route. Reached by tapping a person in the
 * People tab. Gated by YOURS_PAGE_ENABLED (the whole Yours surface is);
 * redirects out if the flag is off so the route can't be deep-linked into
 * a shipped build.
 */
export default function PersonRoute() {
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

  return <KeepPage userId={userId} targetId={id} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cream,
  },
});
