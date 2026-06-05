import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { GROUPS_ENABLED } from '../../../../constants/FeatureFlags';
import CircleHome from '../../../../components/circles/CircleHome';

// Circle home: the stacked surface (noticeboard now; persistent circle chat
// stacks in next). The polymorphic data layer (useChat circle key, useChatList
// circle rows, get_circle/get_my_circles RPCs) is wired behind GROUPS_ENABLED.
// With the flag off this route is not part of the product, so a direct hit
// bounces back to the chat list.
export default function CircleChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!GROUPS_ENABLED) {
    return <Redirect href="/(tabs)/chats" />;
  }
  if (!id) {
    return <Redirect href="/(tabs)/chats" />;
  }

  return <CircleHome circleId={id} />;
}
