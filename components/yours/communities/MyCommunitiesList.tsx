/** Joined communities open their existing public page; management remains contextual. */
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { getMyCommunities, type MyCommunity } from '../../../lib/communityPage';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../../lib/houseCommunity';
import { PublishedPageCover } from '../../creator/pages/PublishedPageCover';
import { PageAction } from '../../creator/pages/PageFrame';

interface Props { onOpen: (communityId: string) => void; onBrowse: () => void; }
const roleLabel: Record<MyCommunity['role'], string> = {
  leader: 'Creator', co_leader: 'Co-creator', admin: 'Admin', events: 'Events team',
  member_care: 'Member care', finance: 'Finance team', member: 'Member',
};

export function MyCommunitiesList({ onOpen, onBrowse }: Props) {
  const identity = useObservedUser();
  const { fonts } = useAfterglowFonts(true, 'creator');
  const mounted = useRef(true);
  const pendingRetry = useRef<object | null>(null);
  const retryOwner = useRef({ viewerId: identity.viewerId, epoch: identity.epoch });
  if (retryOwner.current.viewerId !== identity.viewerId || retryOwner.current.epoch !== identity.epoch) {
    retryOwner.current = { viewerId: identity.viewerId, epoch: identity.epoch };
    pendingRetry.current = null;
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && identity.isCurrent();
  const { data: communities = [], refetch, isRefetching, isLoading, isError } = useQuery({
    queryKey: ['my-communities', identity.viewerId, identity.epoch],
    enabled: !!identity.viewerId && !identity.error,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!isCurrent() || signal.aborted) throw new Error('Account changed.');
      const result = await requestWithDeadline(getMyCommunities(), 12_000);
      if (!isCurrent() || signal.aborted) throw new Error('Account changed.');
      return result;
    },
  });
  const readable = !!identity.viewerId && !identity.error;
  const rows = readable ? communities : [];
  const loading = identity.isLoading || (readable && isLoading);
  const failed = !!identity.error || isError;
  const retry = () => {
    if (!isCurrent() || pendingRetry.current || isRefetching || loading) return;
    const attempt = {};
    pendingRetry.current = attempt;
    void Promise.resolve(readable ? refetch({ cancelRefetch: false }) : identity.retry())
      .catch(() => { /* Read errors are rendered by their owning query or identity observer. */ })
      .finally(() => { if (pendingRetry.current === attempt) pendingRetry.current = null; });
  };
  const body = [s.bodyText, { fontFamily: fonts.regular }];
  return <ScrollView contentContainerStyle={s.content}
    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={retry} tintColor={Colors.terracotta} />}>
    {loading && rows.length === 0 ? <View style={s.feedback}>
      <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading communities" />
      <Text style={body}>Loading your communities…</Text>
    </View> : failed && rows.length > 0 ? <View style={s.recovery}>
      <Text style={[body, s.recoveryCopy]}>Couldn’t refresh. Your communities are still here.</Text>
      <PageAction compact singleLine title={isRefetching ? 'Retrying…' : 'Try again'} disabled={isRefetching} onPress={retry} />
    </View> : failed ? <View style={s.feedback}>
      <Text style={[s.title, { fontFamily: fonts.medium }]}>Couldn’t load your communities</Text>
      <Text style={body}>Try again to see the communities you belong to.</Text>
      <PageAction compact singleLine title="Try again" disabled={isRefetching || loading} onPress={retry} />
    </View> : !readable ? <View style={s.feedback}><Text style={body}>Sign in to see your communities.</Text></View> : null}
    {rows.map(c => {
      const covered = !!(c.cover_media_id || c.cover_image);
      const members = c.member_count === null ? null : `${c.member_count} ${c.member_count === 1 ? 'member' : 'members'}`;
      return <Pressable cssInterop={false} key={c.id} accessibilityRole="button" accessibilityLabel={`Open ${c.name}`}
        onPress={() => { if (isCurrent()) onOpen(c.id); }} style={({ pressed }) => [s.card, pressed && s.pressed]}>
        {c.cover_media_id ? <View style={s.coverClip}><PublishedPageCover pageId={c.id} mediaId={c.cover_media_id} height={132} /></View>
          : c.cover_image ? <Image source={{ uri: c.cover_image }} style={s.cover} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
        <View style={s.row}>
          {!covered && <LinearGradient colors={[CreatorSurfaceColors.selectionTop, CreatorSurfaceColors.selectionBottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.identity}>
            <Text accessible={false} style={[s.initial, { fontFamily: fonts.display }]}>{Array.from(c.name.trim())[0]?.toUpperCase() ?? '·'}</Text>
          </LinearGradient>}
          <View style={s.copy}>
            {isHouseCommunity(c.handle) && <Text style={[s.eyebrow, { fontFamily: fonts.medium }]}>{HOUSE_MARK_LABEL}</Text>}
            <Text style={[s.title, { fontFamily: fonts.medium }]}>{c.name}</Text>
            {members && <Text style={body}>{members}</Text>}
            <Text style={[s.role, { fontFamily: fonts.medium }]}>{roleLabel[c.role]}</Text>
          </View>
          <ChevronRight size={18} color={C.muted} />
        </View>
      </Pressable>;
    })}
    {!loading && !failed && readable && rows.length === 0 && <View style={s.feedback}>
      <Text style={[s.heading, { fontFamily: fonts.display }]}>Find your kind of people</Text>
      <Text style={body}>Join a community to keep its conversations, people and events together here.</Text>
      <PageAction primary compact singleLine title="Explore communities" onPress={() => { if (isCurrent()) onBrowse(); }} />
    </View>}
  </ScrollView>;
}
const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  card: { backgroundColor: Colors.cardBg, borderRadius: 20, borderWidth: 1, borderColor: C.subtleLine, shadowColor: Colors.darkWarm, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  pressed: { opacity: 0.85 },
  cover: { width: '100%', height: 132, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  coverClip: { borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  row: { padding: 16, gap: 14, flexDirection: 'row', alignItems: 'center' },
  identity: { width: 60, height: 68, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  initial: { ...T.pageTitle, color: C.ink },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { ...T.title, color: C.ink },
  heading: { ...T.pageSection, color: C.ink },
  bodyText: { ...T.body, color: C.muted },
  role: { ...T.caption, color: Colors.terracotta },
  eyebrow: { ...T.timestamp, color: Colors.terracotta },
  recovery: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  recoveryCopy: { flex: 1, minWidth: 0 },
  feedback: { paddingVertical: 24, gap: 14, alignItems: 'flex-start' },
});
