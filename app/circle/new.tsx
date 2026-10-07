import React, { useMemo } from 'react';
import { Redirect } from 'expo-router';
import { GROUPS_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import CreateCircleFlow from '../../components/circles/create/CreateCircleFlow';

// Create-circle flow. Gated by GROUPS_ENABLED; a direct hit with the flag off
// bounces to the chat list.
export default function NewCircleScreen() {
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  if (!GROUPS_ENABLED) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CreateCircleFlow appearance={appearance} />;
}
