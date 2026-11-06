import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import PlanComposerV2 from '../components/post/PlanComposerV2';
import { useObservedUser } from '../hooks/useObservedUser';
import { planReviewKey } from '../lib/planCopyReview';

function CheckedReview({ viewerId, reviewId }: {viewerId: string; reviewId: string}) {
  const client = useQueryClient();
  // The originating screen already checked this source. Consume the handoff once. A copied
  // route cannot supply fields or reopen the review after it has ended.
  const [prefill] = useState(() =>
    client.getQueryData<Record<string, string>>(planReviewKey(viewerId, reviewId)));
  useEffect(() => {
    client.removeQueries({queryKey: planReviewKey(viewerId, reviewId), exact: true});
  }, [client, viewerId, reviewId]);
  return prefill ? <PlanComposerV2 reviewPrefill={prefill} /> : <Redirect href="/(tabs)/friends" />;
}

export default function SimilarPlanReview() {
  const { reviewId } = useLocalSearchParams<{reviewId?: string}>();
  const viewer = useObservedUser();
  if (viewer.isLoading) return <View style={{flex: 1, justifyContent: 'center'}}>
    <ActivityIndicator accessibilityLabel="Opening plan preview" />
  </View>;
  if (viewer.error || !viewer.viewerId || !reviewId) return <Redirect href="/(tabs)/friends" />;
  return <CheckedReview key={JSON.stringify([viewer.viewerId, viewer.epoch, reviewId])}
    viewerId={viewer.viewerId} reviewId={reviewId} />;
}
