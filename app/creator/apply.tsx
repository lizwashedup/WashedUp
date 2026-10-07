import { useCreatorApplicationStatus } from '../../hooks/useCreatorApplicationStatus';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Ticket, Users } from 'lucide-react-native';
import Colors, { SceneDetailColors as Scene, CreatorSurfaceColors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import ProfileButton from '../../components/ProfileButton';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { friendlyError } from '../../lib/friendlyError';
import { withdrawOperatorApplication, type OperatorGrant, type OperatorTrack } from '../../lib/operatorApplications';

const TRACK_CARDS: {
  track: OperatorTrack;
  title: string;
  blurb: string;
  route: string;
  Icon: typeof Ticket;
}[] = [
  {
    track: 'community_leader',
    title: 'Community',
    blurb: 'An ongoing group people join, with conversations and events that bring everyone together.',
    route: '/creator/apply-community',
    Icon: Users,
  },
  {
    track: 'event_host',
    // The existing event application remains the organization track.
    title: 'Organization',
    blurb: 'For businesses, venues, teams, or people putting on events.',
    route: '/creator/apply-events',
    Icon: Ticket,
  },
];

function statusLine(grant: OperatorGrant | undefined): { label: string; tappable: boolean } | null {
  if (!grant) return null;
  switch (grant.status) {
    case 'applied':
    case 'in_review':
      return { label: "Application received. Check Apply to Scene for updates.", tappable: false };
    case 'needs_more_info':
      return { label: grant.applicant_message ? `More information requested: ${grant.applicant_message}` : 'More information requested. Open your application to update it.', tappable: true };
    case 'approved':
      return { label: 'Approved', tappable: false };
    case 'declined':
      return { label: 'Your previous application was not approved. You can apply again.', tappable: true };
    case 'revoked':
      return { label: 'This application is closed for your account. Contact us if you need help.', tappable: false };
    case 'withdrawn':
      return { label: 'Application withdrawn. You can apply again.', tappable: true };
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
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = React.useMemo(() => createStyles(fonts), [fonts]);
  const queryClient = useQueryClient();
  const [withdrawingId, setWithdrawingId] = React.useState<string | null>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  // Screen 47 copy redesign (delta matrix / doc 12.5 language contract):
  // "Choose one / See the difference", never "Choose a path" or "Compare
  // paths" -- this screen never calls the two tracks "paths".
  const [showDifference, setShowDifference] = React.useState(false);

  const { grants, isLoading, error: statusError, signedOut, refresh, current } = useCreatorApplicationStatus();

  const confirmWithdraw = (grant: OperatorGrant) => {
    if (!current()) return;
    hapticLight();
    setAlertInfo({
      title: 'Withdraw this application?',
      message: "You can apply again anytime. This just clears your current request.",
      buttons: [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Withdraw',
          onPress: async () => {
            if (!current()) return;
            setWithdrawingId(grant.id);
            try {
              await withdrawOperatorApplication(grant.id);
              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['my-operator-grants'] });
              if (current()) void refresh().catch(() => undefined);
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
    <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={22} color={Scene.text} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>Apply to Scene</Text>
        <ProfileButton surface="scene" />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Scene.action} />
        </View>
      ) : statusError ? <View style={styles.content}><Text accessibilityRole="alert">Couldn’t load your application status.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry application status" onPress={() => void refresh().catch(() => undefined)} style={styles.withdrawButton}><Text style={styles.withdrawLink}>Try again</Text></TouchableOpacity></View> : signedOut ? <View style={styles.content}><Text>Sign in to check your applications.</Text></View> : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.introduction}>
            <Text accessibilityRole="header" style={styles.title}>Be a part of the Scene.</Text>
            <Text style={styles.intro}>Bring your community or organization to Scene. Choose one, or apply for both.</Text>
          </View>
          <View style={styles.reviewNotice}>
            <Text style={styles.reviewText}>We’ll review new applications when the refreshed Scene is ready.</Text>
          </View>

          <View style={styles.trackList}>
          {TRACK_CARDS.map(({ track, title, blurb, route, Icon }) => {
            const grant = grants.find((g) => g.track === track);
            const status = statusLine(grant);
            const locked = !!status && !status.tappable;
            return (
              <View key={track} style={styles.card}>
                <TouchableOpacity
                  style={styles.trackChoice}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply for ${track === 'community_leader' ? 'a community' : 'an organization'}`}
                  accessibilityState={{ disabled: locked }}
                  disabled={locked}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (locked || !current()) return;
                    hapticLight();
                    router.push(route as never);
                  }}
                >
                  <View style={styles.cardHeading}>
                    <View style={styles.cardIconWrap}>
                      <Icon size={20} color={Scene.action} strokeWidth={2} />
                    </View>
                    <Text style={styles.cardTitle}>{title}</Text>
                    {!locked && <ChevronRight size={18} color={Scene.supporting} strokeWidth={2} />}
                  </View>
                  <Text style={styles.cardBlurb}>{blurb}</Text>
                </TouchableOpacity>
                {status && (
                  <View style={[styles.statusPanel, grant?.status === 'approved' && styles.statusPanelApproved]}>
                    <Text style={styles.statusText}>{status.label}</Text>
                    {grant?.status === 'approved' && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${title.toLowerCase()} creator space`} style={styles.withdrawButton} onPress={() => { if (current()) router.push((CREATOR_PAGES_ENABLED ? '/creator/pages' : track === 'community_leader' ? '/(creator)/today' : '/(creator)/organizer-home') as never); }}><Text style={styles.withdrawLink}>Open creator space</Text></TouchableOpacity>}
                    {canWithdraw(grant) && (
                      <TouchableOpacity
                        style={styles.withdrawButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Withdraw ${title.toLowerCase()} application`}
                        accessibilityState={{ disabled: withdrawingId === grant!.id, busy: withdrawingId === grant!.id }}
                        onPress={() => confirmWithdraw(grant!)}
                        disabled={withdrawingId === grant!.id}
                      >
                        {withdrawingId === grant!.id ? (
                          <ActivityIndicator size="small" color={Scene.action} />
                        ) : (
                          <Text style={styles.withdrawLink}>Withdraw</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          </View>

          <TouchableOpacity
            style={styles.differenceToggle}
            onPress={() => {
              hapticLight();
              setShowDifference((v) => !v);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="See the difference between a community and an organization"
            accessibilityState={{ expanded: showDifference }}
          >
            <Text style={styles.differenceToggleText}>See the difference</Text>
            <ChevronDown size={16} color={Scene.action} strokeWidth={2.5} style={showDifference ? styles.chevronOpen : undefined} />
          </TouchableOpacity>

          {showDifference && (
            <View style={styles.differenceCard}>
              <View style={styles.differenceRow}>
                <Text style={styles.differenceWho}>Community</Text>
                <Text style={styles.differenceWhat}>A group people can join and keep coming back to. Includes shared conversations and events.</Text>
              </View>
              <View style={[styles.differenceRow, styles.differenceRowLast]}>
                <Text style={styles.differenceWho}>Organization</Text>
                <Text style={styles.differenceWhat}>A place to publish events for your business, venue, team, or yourself. Does not include an ongoing member group.</Text>
              </View>
            </View>
          )}
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
    </LinearGradient>
  );
}

const createStyles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Scene.lower },
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.text },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 16 },
  introduction: { gap: 12 },
  title: { fontFamily: fonts.display, fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Scene.text },
  intro: { fontFamily: fonts.regular, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Scene.supporting },
  reviewNotice: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: Scene.action },
  reviewText: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.supporting },
  trackList: { width: '100%', gap: 12 },
  // The View owns full-width geometry; descriptions and status never share the
  // narrow title/icon row or nest a Withdraw target inside a disabled selector.
  card: { width: '100%', alignSelf: 'stretch', minWidth: 0, borderRadius: 20, backgroundColor: Scene.surface, borderWidth: 1, borderColor: Scene.border, overflow: 'hidden' },
  trackChoice: { alignSelf: 'stretch', minWidth: 0, minHeight: 44, padding: 16, gap: 10 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  cardIconWrap: { width: 36, height: 36, flexShrink: 0, borderRadius: 12, backgroundColor: CreatorSurfaceColors.sunsetGoldLight, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Scene.text },
  cardBlurb: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.supporting },
  statusPanel: { marginHorizontal: 16, marginBottom: 16, padding: 12, gap: 6, borderRadius: 12, backgroundColor: Colors.creamWarm, alignSelf: 'stretch' },
  statusPanelApproved: { backgroundColor: CreatorSurfaceColors.sunsetGoldLight },
  statusText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.text },
  withdrawButton: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 },
  withdrawLink: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.action },
  differenceToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8 },
  differenceToggleText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.action },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  differenceCard: { width: '100%', backgroundColor: Scene.surface, borderRadius: 16, borderWidth: 1, borderColor: Scene.border },
  differenceRow: { padding: 16, borderBottomWidth: 1, borderBottomColor: Scene.border, gap: 6 },
  differenceRowLast: { borderBottomWidth: 0 },
  differenceWho: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.text },
  differenceWhat: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.supporting },
});
