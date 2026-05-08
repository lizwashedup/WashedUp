import { Redirect, useLocalSearchParams } from 'expo-router';

// Universal Link landing for https://washedup.app/e/<id>. Native deep link
// hands the URL to this route; we redirect to the canonical plan detail
// screen at app/plan/[id].tsx.
export default function PlanShortlink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id || typeof id !== 'string') return <Redirect href="/(tabs)/plans" />;
  return <Redirect href={`/plan/${id}` as any} />;
}
