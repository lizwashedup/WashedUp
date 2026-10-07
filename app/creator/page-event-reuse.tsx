import React from 'react';
import {Redirect, useLocalSearchParams} from 'expo-router';
import {CREATOR_PAGES_ENABLED} from '../../constants/FeatureFlags';
import {mediaUUID} from '../../lib/creatorPageEventMedia';
import CreatorPageEventReuseScreen from '../../components/creator/pages/CreatorPageEventReuseScreen';

export default function PageEventReuseRoute() {
  const {pageId, sourceEventId, templateId} = useLocalSearchParams<{pageId?: string; sourceEventId?: string; templateId?: string}>();
  if (!CREATOR_PAGES_ENABLED || !mediaUUID(pageId) || !mediaUUID(sourceEventId) || templateId !== undefined && !mediaUUID(templateId)) return <Redirect href="/(tabs)/friends" />;
  const source = templateId ? {kind: 'template' as const, pageId, eventId: sourceEventId, templateId} : {kind: 'event' as const, pageId, eventId: sourceEventId};
  return <CreatorPageEventReuseScreen pageId={pageId} source={source} />;
}
