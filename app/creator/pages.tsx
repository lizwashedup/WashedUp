import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import CreatorPagesScreen from '../../components/creator/pages/CreatorPagesScreen';
export default function YourPagesRoute() {
  const { create } = useLocalSearchParams<{ create?: string }>();
  const creationKind = create === 'community' || create === 'event' ? create : undefined;
  return CREATOR_PAGES_ENABLED ? <CreatorPagesScreen key={creationKind ?? 'manage'} creationKind={creationKind} /> : <Redirect href="/(tabs)/friends" />;
}
