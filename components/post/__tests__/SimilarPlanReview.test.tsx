import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SimilarPlanReview from '../../../app/similar-plan';
import { planReviewKey } from '../../../lib/planCopyReview';
import PlanComposerV2 from '../PlanComposerV2';
import { Redirect } from 'expo-router';

let mockOwner = 'alice';
jest.mock('../../../hooks/useObservedUser', () => ({
  useObservedUser: () => ({viewerId:mockOwner, epoch:1, isLoading:false, error:null}),
}));
jest.mock('../../../lib/supabase', () => ({supabase:{}}));
jest.mock('expo-router', () => ({useLocalSearchParams: () => ({
  reviewId:'request', draftId:'unrelated', prefillInvitePersonId:'untrusted',
}), Redirect: () => null}));
jest.mock('../PlanComposerV2', () => ({__esModule:true,default:()=>null}));

it('uses only the checked prefill, consumes it, and retires the review on an account switch', () => {
  const client = new QueryClient();
  const key = planReviewKey(mockOwner,'request');
  const checked = {prefillTitle:'Fictional picnic',similarPlanRequest:'request'};
  client.setQueryData(key,checked);
  const screen = () => <QueryClientProvider client={client}><SimilarPlanReview/></QueryClientProvider>;
  let tree!: ReactTestRenderer;
  try {
    act(()=>{tree=create(screen());});
    expect(tree.root.findByType(PlanComposerV2).props.reviewPrefill).toEqual(checked);
    expect(client.getQueryData(key)).toBeUndefined();
    mockOwner='bob';act(()=>tree.update(screen()));
    expect(tree.root.findAllByType(PlanComposerV2)).toHaveLength(0);
    expect(tree.root.findByType(Redirect).props.href).toBe('/(tabs)/friends');
    mockOwner='alice';act(()=>tree.update(screen()));
    expect(tree.root.findAllByType(PlanComposerV2)).toHaveLength(0);
  } finally {
    act(()=>tree?.unmount());client.clear();mockOwner='alice';
  }
});
