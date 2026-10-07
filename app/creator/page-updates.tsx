import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import CreatorPageUpdatesScreen from '../../components/creator/pages/CreatorPageUpdatesScreen';
export default function CreatorPageUpdatesRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return CREATOR_PAGES_ENABLED && typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? <CreatorPageUpdatesScreen key={id} pageId={id} /> : <Redirect href="/(tabs)/friends" />;
}
