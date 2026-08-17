import { Redirect, Slot } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { communityRouteDecision } from '../../lib/communityRouteGate';
import { getCreatorAccess, hasCreatorAccess } from '../../lib/creatorMode';

export default function CommunityThreadRouteLayout() {
  // Grant-gated exception (mirrors app/(creator)/_layout.tsx, 8-17): a real
  // grant-holding creator reaches their own rooms and public-page previews
  // through this route even while the flag is off. Everyone else still
  // bounces to explore exactly as before.
  const { data: access, isLoading } = useQuery({
    queryKey: ['creator-access'],
    queryFn: getCreatorAccess,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment }}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  const decision = communityRouteDecision(COMMUNITIES_ENABLED, hasCreatorAccess(access));
  return decision.allowed ? <Slot /> : <Redirect href={decision.redirect} />;
}
