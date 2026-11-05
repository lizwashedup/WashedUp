import { Redirect, useGlobalSearchParams, useSegments } from 'expo-router';
import { legacyManagementDestination } from '../../lib/managementNavigation';

/** Compatibility for saved links and notifications from older app versions. */
export default function LegacyCreatorRedirect() {
  const segments = useSegments();
  const params = useGlobalSearchParams();
  return <Redirect href={legacyManagementDestination(segments, params) as never} />;
}
