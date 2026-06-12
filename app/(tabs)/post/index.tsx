/**
 * Post tab route - composer gate.
 *
 * Flag-off prod renders the legacy composer untouched (today's behavior plus
 * the already-swapped WashedUpCalendar). Flag-on renders the redesigned
 * PlanComposerV2. The two are fully separate trees: legacy is frozen, V2 owns
 * its own state/submit. POST-FLIP CLEANUP: once YOURS_PAGE_ENABLED is
 * permanent, delete LegacyComposer + this gate and promote V2.
 */
import { YOURS_PAGE_ENABLED } from '../../../constants/FeatureFlags';
import LegacyComposer from '../../../components/post/LegacyComposer';
import PlanComposerV2 from '../../../components/post/PlanComposerV2';

export default function PostScreen() {
  return YOURS_PAGE_ENABLED ? <PlanComposerV2 /> : <LegacyComposer />;
}
