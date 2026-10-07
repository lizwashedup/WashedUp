import React from 'react';
import { Redirect } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import CreatorPagesScreen from '../../components/creator/pages/CreatorPagesScreen';
export default function YourPagesRoute() {
  return CREATOR_PAGES_ENABLED ? <CreatorPagesScreen /> : <Redirect href="/(tabs)/friends" />;
}
