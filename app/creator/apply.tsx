import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Ticket, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { friendlyError } from '../../lib/friendlyError';
import { fetchMyGrants, withdrawOperatorApplication, type OperatorGrant, type OperatorTrack } from '../../lib/operatorApplications';

const TRACK_CARDS: {
  track: OperatorTrack;
  title: string;
  blurb: string;
  route: string;
  Icon: typeof Ticket;
}[] = [
  {
    track: 'event_host',
    // LIZ COPY (decision 16: put on / start; never host, post, lead)
    title: 'put on events',
    blurb: 'put your events on the scene. shows, dinners, pop-ups, anything real.',
    route: '/creator/apply-events',
    Icon: Ticket,
  },
  {
    track: 'community_leader',
    title: 'start a community',
    blurb: 'a group people join and belong to, run by you. putting on events comes with it.',
    route: '/creator/apply-community',
    Icon: Users,
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
    case 'withdrawn':
      return { label: 'you withdrew this application. apply again anytime.', tappable: true };
  }
}

// inventory S-01: a real "withdraw my application" action, not a dead enum
// value. Only offered while a decision has not been made yet -- once
// declined/approved/revoked, withdrawing no longer means anything.
function canWithdraw(grant: OperatorGrant | undefined): boolean {
  return !!grant && (grant.status === 'applied' || grant.status === 'in_review' || grant.status === 'needs_more_info');
}

export default function CreatorApplyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [withdrawingId, setWithdrawingId] = React.useState<string | null>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

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

  const confirmWithdraw = (grant: OperatorGrant) => {
    hapticLight();
    setAlertInfo({
      title: 'withdraw this application?',
      message: "you can apply again anytime, this just clears today's request.",
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'withdraw',
          onPress: async () => {
            setWithdrawingId(grant.id);
            try {
              await withdrawOperatorApplication(grant.id);
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['my-operator-grants'] });
            } catch (e) {
              setAlertInfo({ title: 'That did not go through', message: friendlyError(e, 'Try again in a moment.') });
            } finally {
              setWithdrawingId(null);
            }
          },
        },
      ],
    });
  };

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
                      {canWithdraw(grant) && (
                        <TouchableOpacity
                          onPress={() => confirmWithdraw(grant!)}
                          disabled={withdrawingId === grant!.id}
                          hitSlop={8}
                        >
                          {withdrawingId === grant!.id ? (
                            <ActivityIndicator size="small" color={Colors.terracotta} style={styles.withdrawSpinner} />
                          ) : (
                            <Text style={styles.withdrawLink}>withdraw</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
                {!locked && <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
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
  withdrawLink: {
    marginTop: 6,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  withdrawSpinner: { marginTop: 6, alignSelf: 'flex-start' },
});
