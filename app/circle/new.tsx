import React from 'react';
import { Redirect } from 'expo-router';
import { GROUPS_ENABLED } from '../../constants/FeatureFlags';
import CreateCircleFlow from '../../components/circles/create/CreateCircleFlow';

// Create-circle flow. Gated by GROUPS_ENABLED; a direct hit with the flag off
// bounces to the chat list.
export default function NewCircleScreen() {
  if (!GROUPS_ENABLED) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CreateCircleFlow />;
}
