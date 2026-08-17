import { Redirect, Slot } from 'expo-router';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { communityRouteDecision } from '../../lib/communityRouteGate';

export default function CommunitiesRouteLayout() {
  const decision = communityRouteDecision(COMMUNITIES_ENABLED);
  return decision.allowed ? <Slot /> : <Redirect href={decision.redirect} />;
}
