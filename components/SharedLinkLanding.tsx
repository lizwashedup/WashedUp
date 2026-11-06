import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { useObservedUser } from '../hooks/useObservedUser';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { supabase } from '../lib/supabase';

type LinkKind = 'id' | 'slug';

async function resolveLink(kind: LinkKind, value: string, isCurrent: () => boolean) {
  if (kind === 'id') {
    const event = await requestWithDeadline(supabase.from('explore_events').select('id')
      .eq('id', value).maybeSingle(), 12_000);
    if (event.error?.code === '22P02') return null; // Invalid UUID for both ID columns.
    if (event.error) throw event.error;
    if (!isCurrent()) throw new Error('Link visit ended');
    if (event.data?.id) return '/event/' + event.data.id;
  }
  const plan = await requestWithDeadline(supabase.from('events').select('id')
    .eq(kind, value).maybeSingle(), 12_000);
  if (plan.error) throw plan.error;
  return plan.data?.id ? '/plan/' + plan.data.id : null;
}

export function SharedLinkLanding({kind}: {kind: LinkKind}) {
  const params = useLocalSearchParams();
  const value = params[kind];
  const valid = typeof value === 'string' && value.length > 0;
  const viewer = useObservedUser({allowSignedOut:true});
  const ready = !viewer.isLoading && !viewer.error;
  const lookup = useQuery({
    queryKey: ['shared-link', kind, value, viewer.viewerId, viewer.epoch],
    queryFn: () => resolveLink(kind, value as string, viewer.isCurrent),
    enabled: valid && ready, retry: false, gcTime: 0, refetchOnMount: 'always',
  });
  const loading = valid && (viewer.isLoading || (ready && (lookup.isPending || lookup.isFetching)));
  const failed = valid && (!!viewer.error || lookup.isError);
  if (valid && ready && viewer.isCurrent() && !loading && !failed && lookup.data) {
    const query = Object.entries(params).filter(([key]) => key !== kind)
      .map(([key, raw]) => encodeURIComponent(key) + '=' + encodeURIComponent(Array.isArray(raw) ? raw[0] ?? '' : raw ?? ''))
      .join('&');
    return <Redirect href={(lookup.data + (query ? '?' + query : '')) as never}/>;
  }

  return <SafeAreaView style={s.container} edges={['top','bottom']}>
    <View style={s.centered}>
      {loading ? <ActivityIndicator size="large" color={Colors.terracotta} accessibilityLabel="Opening shared link"/> : <>
        <Text style={s.title}>{failed ? 'couldn’t open this link' : 'this link isn’t available'}</Text>
        <Text style={s.body}>{failed ? 'We couldn’t check whether it’s available.' : 'It may have been removed or may be private.'}</Text>
        {failed && <TouchableOpacity accessibilityRole="button" style={s.cta} onPress={() => {
          if (viewer.error) void viewer.retry();
          else if (viewer.isCurrent()) void lookup.refetch({cancelRefetch:false});
        }}><Text style={s.ctaText}>try again</Text></TouchableOpacity>}
      </>}
      <TouchableOpacity accessibilityRole="button" style={s.exit} onPress={()=>router.replace('/(tabs)/plans')}>
        <Text style={s.exitText}>see what's on</Text>
      </TouchableOpacity>
    </View>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  container:{flex:1,backgroundColor:Colors.parchment},
  centered:{flex:1,alignItems:'center',justifyContent:'center',paddingHorizontal:32,gap:10},
  title:{fontFamily:Fonts.displayBold,fontSize:FontSizes.displayMD,color:Colors.asphalt,textAlign:'center'},
  body:{fontFamily:Fonts.sans,fontSize:FontSizes.bodyMD,color:Colors.textMedium,textAlign:'center'},
  cta:{marginTop:12,backgroundColor:Colors.terracotta,borderRadius:999,paddingVertical:14,paddingHorizontal:28,minHeight:44,justifyContent:'center'},
  ctaText:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyMD,color:Colors.white},
  exit:{minHeight:44,justifyContent:'center',paddingHorizontal:16},
  exitText:{fontFamily:Fonts.sansBold,fontSize:FontSizes.bodyMD,color:Colors.terracotta},
});
