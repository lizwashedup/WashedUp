import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import CreatorPageScreen from '../../components/creator/pages/CreatorPageScreen';
export default function CreatorPageRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return CREATOR_PAGES_ENABLED && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
    ? <CreatorPageScreen key={id} pageId={id} /> : <Redirect href="/(tabs)/friends" />;
}
