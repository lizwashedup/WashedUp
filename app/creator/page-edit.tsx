import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import ApprovedPageEditorScreen from '../../components/creator/pages/ApprovedPageEditorScreen';
import CreatorPageEditorScreen from '../../components/creator/pages/CreatorPageEditorScreen';
export default function PageEditorRoute() {
  const { id, mode, from } = useLocalSearchParams<{ id?: string; mode?: string; from?: string }>();
  return CREATOR_PAGES_ENABLED && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
    ? mode === 'approved' ? <ApprovedPageEditorScreen key={id} pageId={id} returnToTeam={from === 'team'} /> : <CreatorPageEditorScreen key={id} pageId={id} /> : <Redirect href="/(tabs)/friends" />;
}
