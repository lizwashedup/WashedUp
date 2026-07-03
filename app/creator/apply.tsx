import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Sparkles, UsersRound } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { fetchMyGrants, type OperatorGrant, type OperatorTrack } from '../../lib/operatorApplications';

const TRACK_CARDS: {
  track: OperatorTrack;
  title: string;
  blurb: string;
  route: string;
  Icon: typeof Sparkles;
}[] = [
  {
    track: 'event_host',
    title: 'host events',
    blurb: 'post one-off events to the scene. shows, dinners, runs, anything you run for real.',
    route: '/creator/apply-events',
    Icon: Sparkles,
  },
  {
    track: 'community_leader',
    title: 'lead a community',
    blurb: 'an ongoing crew people join and belong to. you also get event hosting with it.',
    route: '/creator/apply-community',
    Icon: UsersRound,
  },
];

function statusLine(grant: OperatorGrant | undefined): { label: string; tappable: boolean } | null {
  if (!grant) return null;
  switch (grant.status) {
    case 'applied':
    case 'in_review':
      return { label: "a real person is reading this, you'll hear from us within a day", tappable: false };
    case 'needs_more_info':
      return { label: grant.applicant_message ? `one thing before we say yes: ${grant.applicant_message}` : 'one thing before we say yes. tap to update your application.', tappable: true };
    case 'approved':
      return { label: "you're in", tappable: false };
    case 'declined':
      return { label: 'not the right fit last time. the door stays open, apply again anytime.', tappable: true };
    case 'revoked':
      return { label: 'this track is closed for your account. reach out if that seems wrong.', tappable: false };
  }
}

export default function CreatorApplyScreen() {
  const router = useRouter();

  const { data: grants = [], isLoading, refetch } = useQuery({
    queryKey: ['my-operator-grants'],
    queryFn: fetchMyGrants,
    staleTime: 15_000,
  });

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>run things on washedup</Text>
          <Text style={styles.intro}>
            real people run real things here. tell us who you are and what you want to bring to LA.
            a human reads every application and replies within a day.
          </Text>

          {TRACK_CARDS.map(({ track, title, blurb, route, Icon }) => {
            const grant = grants.find((g) => g.track === track);
            const status = statusLine(grant);
            const locked = !!status && !status.tappable;
            return (
              <TouchableOpacity
                key={track}
                style={[styles.card, locked && styles.cardLocked]}
                activeOpacity={locked ? 1 : 0.8}
                onPress={() => {
                  if (locked) return;
                  hapticLight();
                  router.push(route as never);
                }}
              >
                <View style={styles.cardIconWrap}>
                  <Icon size={22} color={Colors.terracotta} strokeWidth={2} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text style={styles.cardBlurb}>{blurb}</Text>
                  {status && (
                    <View style={[styles.statusPill, grant?.status === 'approved' && styles.statusPillApproved]}>
                      <Text
                        style={[styles.statusText, grant?.status === 'approved' && styles.statusTextApproved]}
                        numberOfLines={3}
                      >
                        {status.label}
                      </Text>
                    </View>
                  )}
                </View>
                {!locked && <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  content: { paddingHorizontal: 24, paddingBottom: 48, gap: 14 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  intro: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    marginBottom: 12,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  cardLocked: { opacity: 0.9 },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  cardBlurb: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.secondary,
  },
  statusPill: {
    marginTop: 8,
    backgroundColor: Colors.creamWarm,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'stretch',
  },
  statusPillApproved: { backgroundColor: Colors.goldBadgeSoft },
  statusText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.quoteText,
  },
  statusTextApproved: { color: Colors.darkWarm },
});
