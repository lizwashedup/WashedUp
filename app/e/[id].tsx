/**
 * Universal Link landing for https://washedup.app/e/<id>.
 *
 * The SAME short link carries two different objects: a PLAN (`events` row,
 * shared from the plan page) and an EVENT (`explore_events` row, shared from
 * the event page). This route used to redirect every id to /plan/<id>, so
 * every shared EVENT link opened the app and died on "Couldn't load this
 * plan." (audit finding 1). The app claims /e/* on both platforms, so that
 * was every event share, to every person who has the app.
 *
 * We disambiguate by ASKING which table owns the id, never by guessing.
 * Events are checked first (they are the link people share publicly), then
 * plans. An id in neither gets a real screen with a way onward, not a bounce.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';

type Target = 'event' | 'plan' | 'missing';

async function resolveTarget(id: string): Promise<Target> {
  // a malformed id fails the uuid cast; supabase-js reports it as an error
  // rather than throwing, so both reads simply come back empty
  const { data: event } = await supabase
    .from('explore_events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (event?.id) return 'event';
  const { data: plan } = await supabase
    .from('events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  return plan?.id ? 'plan' : 'missing';
}

export default function ShortLinkLanding() {
  const params = useLocalSearchParams<{ id: string }>();
  const { id } = params;
  const [target, setTarget] = useState<Target | null>(null);

  // S-05 deep-link contract: any extra query params on the short link
  // (task / return_route / filter / revision) ride along to the resolved
  // screen instead of dying here (they used to be dropped, fixed 2026-08-25).
  const forwardedSearch = useMemo(() => {
    const entries = Object.entries(params).filter(([key]) => key !== 'id');
    if (entries.length === 0) return '';
    const qs = entries
      .map(([key, value]) => {
        const v = Array.isArray(value) ? value[0] ?? '' : String(value ?? '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
      })
      .join('&');
    return `?${qs}`;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    if (!id || typeof id !== 'string') {
      setTarget('missing');
      return;
    }
    resolveTarget(id)
      .then((t) => { if (!cancelled) setTarget(t); })
      .catch(() => { if (!cancelled) setTarget('missing'); });
    return () => { cancelled = true; };
  }, [id]);

  if (target === 'event') return <Redirect href={`/event/${id}${forwardedSearch}` as never} />;
  if (target === 'plan') return <Redirect href={`/plan/${id}${forwardedSearch}` as never} />;

  if (target === 'missing') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          {/* copy to the taste gate: never a dead end, always a way on */}
          <Text style={styles.title}>this one is gone</Text>
          <Text style={styles.body}>the link may be old, or whoever made it took it down.</Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => router.replace('/(tabs)/plans' as never)}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>see what's on</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Colors.terracotta} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  cta: {
    marginTop: 12, backgroundColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 28, minHeight: 44, justifyContent: 'center',
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
