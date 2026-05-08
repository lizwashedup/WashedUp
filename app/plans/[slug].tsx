import { Redirect, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

// Universal Link landing for https://washedup.app/plans/<slug>. Resolves the
// slug to an event id via Supabase, then redirects to the canonical plan
// detail screen.
export default function PlanSlugShortlink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['planSlugLookup', slug],
    queryFn: async () => {
      if (!slug || typeof slug !== 'string') return null;
      const { data } = await supabase
        .from('events')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment }}>
        <ActivityIndicator color={Colors.terracotta} />
      </View>
    );
  }
  if (!data) return <Redirect href="/(tabs)/plans" />;
  return <Redirect href={`/plan/${data}` as any} />;
}
