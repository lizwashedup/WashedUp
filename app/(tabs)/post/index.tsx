/**
 * Post tab route.
 *
 * Legacy composer removed 2026-08-24 — dead since the YOURS_PAGE_ENABLED
 * flip (see constants/FeatureFlags.ts). Pure wrapper around PlanComposerV2.
 */
import PlanComposerV2 from '../../../components/post/PlanComposerV2';

export default function PostScreen() {
  return <PlanComposerV2 />;
}
