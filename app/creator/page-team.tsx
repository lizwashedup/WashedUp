import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import CreatorPageTeamScreen from '../../components/creator/pages/CreatorPageTeamScreen';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export default function CreatorPageTeamRoute() {
  const { id, invitationId } = useLocalSearchParams<{ id?: string; invitationId?: string }>();
  return CREATOR_PAGES_ENABLED && uuid(id) && (invitationId === undefined || uuid(invitationId))
    ? <CreatorPageTeamScreen key={`${id}:${invitationId ?? 'team'}`} pageId={id} invitationId={invitationId} /> : <Redirect href="/(tabs)/friends" />;
}
