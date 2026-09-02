/**
 * C-11 member detail. Today the roster row only ever showed name, role,
 * joined date, and a remove button; this is the drill-down a leader gets by
 * tapping an active member. Adds their real event history in this
 * community -- ticket purchases and plain RSVPs, both already tracked by
 * the buyer-side tables -- plus their join answers when they gave any
 * (already fetched for the roster's pending section; active members carry
 * the same card). No notes-style field exists anywhere on a community
 * member (checked lib/creatorMode.ts and every migration for one), so
 * there is nothing to show there and nothing invented here.
 *
 * Screen 17 gap closure (consent + moderation history), read-only, no
 * schema change:
 *
 * - Consent: real and shown below. `guidelines_accepted_at` is enforced
 *   evidence -- request_to_join_community()/submit_join_request() raise
 *   unless it's true -- and was already being fetched onto `answers` by
 *   getJoinAnswerCards() (JoinAnswerCard.guidelines_accepted_at, see
 *   creatorMode.ts) for the intro card above; it just wasn't rendered.
 *   This adds the missing render only, same data, same query, no new RLS.
 *
 * - Moderation history: deliberately NOT added, flagged instead. There is
 *   no community-scoped moderation record to show a leader for this
 *   member. community_member_status has a 'banned' value in its enum, but
 *   nothing ever writes it -- removeMember() below only ever sets
 *   'removed', with no reason, no actor, and no history kept beyond the
 *   row's generic updated_at. The only populated moderation-shaped tables
 *   (moderation_actions, reports, banned_identifiers) are app-wide platform
 *   bans -- written only by admin_ban_user() / auto_ban_reported_user(),
 *   gated to is_admin()/has_role('admin') or the row's own user, unrelated
 *   to community leadership, and out of scope for a community leader to
 *   read regardless: moderation_actions.metadata was flagged by a live
 *   security audit (docs/database/live-function-correctness-audit-
 *   20260824.md, P1) for embedding an unbounded raw private-message
 *   archive with no access-control minimization. Wiring a leader-facing
 *   read into that table is a real access-policy call for Josh/Liz, not a
 *   UI addition -- reported, not built.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack, Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Ticket, CalendarCheck, RotateCcw } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { friendlyError } from '../../../lib/friendlyError';
import { hapticLight } from '../../../lib/haptics';
import { formatEventDateLA } from '../../../lib/laDate';
import {
  getCreatorAccess,
  canManageMembers,
  creatorLandingRoute,
  coCreatorRoleTag,
  getCommunityMember,
  getJoinAnswerCards,
  getMemberEventHistory,
  removeMember,
  type MemberEventHistoryItem,
} from '../../../lib/creatorMode';

export default function MemberDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [removing, setRemoving] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const { data: member, isLoading } = useQuery({
    queryKey: ['creator-member', id],
    queryFn: () => getCommunityMember(id!),
    enabled: !!id,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['creator-member-history', member?.community_id, member?.user_id],
    queryFn: () => getMemberEventHistory(member!.community_id, member!.user_id),
    enabled: !!member,
  });

  // the same join-answers card the roster's pending section shows, keyed
  // by this membership row -- an active member who answered at join time
  // carries the same card, just never surfaced past approval until now
  const { data: answersByMember } = useQuery({
    queryKey: ['join-answer-cards', member?.community_id],
    queryFn: () => getJoinAnswerCards(member!.community_id),
    enabled: !!member,
  });
  const answers = member ? answersByMember?.get(member.id) : undefined;

  const confirmRemove = () => {
    if (!member) return;
    hapticLight();
    setAlertInfo({
      title: `Remove ${member.name ?? 'this member'}?`,
      message: 'They lose access to the community and its chat.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeMember(member.id);
              queryClient.invalidateQueries({ queryKey: ['creator-members'] });
              router.back();
            } catch (e) {
              setAlertInfo({ title: 'That did not work', message: friendlyError(e, 'Try again in a moment.') });
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    });
  };

  const renderHistoryRow = (h: MemberEventHistoryItem, idx: number) => (
    <View key={`${h.eventId}-${idx}`} style={styles.historyRow}>
      {h.imageUrl ? (
        <Image source={{ uri: h.imageUrl }} style={styles.historyThumb} contentFit="cover" />
      ) : (
        <View style={[styles.historyThumb, styles.historyThumbFallback]}>
          {h.kind === 'ticket' ? (
            <Ticket size={16} color={Colors.terracotta} strokeWidth={2} />
          ) : (
            <CalendarCheck size={16} color={Colors.terracotta} strokeWidth={2} />
          )}
        </View>
      )}
      <View style={styles.historyBody}>
        <Text style={styles.historyTitle} numberOfLines={1}>{h.title}</Text>
        <Text style={styles.historyMeta} numberOfLines={1}>
          {h.eventDate ? formatEventDateLA(h.eventDate) : 'date not set'}
          {h.kind === 'ticket' ? ` · ${h.tierName ? `bought ${h.tierName}` : 'bought a ticket'}` : ' · RSVP’d'}
        </Text>
      </View>
      {h.refunded && (
        <View style={styles.refundBadge}>
          <RotateCcw size={11} color={Colors.tertiary} strokeWidth={2.5} />
          <Text style={styles.refundBadgeText}>refunded</Text>
        </View>
      )}
    </View>
  );

  if (access && !canManageMembers(access)) return <Redirect href={creatorLandingRoute(access)} />;

  if (isLoading || !id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  if (!member) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>that member could not be found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{member.name ?? 'member'}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileRow}>
          {member.photo_url ? (
            <Image source={{ uri: member.photo_url }} style={styles.face} contentFit="cover" />
          ) : (
            <View style={[styles.face, styles.facePlaceholder]}>
              <Text style={styles.faceInitial}>{(member.name ?? '?').slice(0, 1).toLowerCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {member.name ?? 'someone'}
              {member.role !== 'member' && (
                <Text style={styles.roleTag}>{coCreatorRoleTag(member.role)}</Text>
              )}
            </Text>
            <Text style={styles.meta}>
              joined {member.joined_at ? formatEventDateLA(member.joined_at) : 'recently'}
            </Text>
          </View>
        </View>

        {!!answers && (!!answers.intro_answer || !!answers.area) && (
          <View style={styles.answersCard}>
            <Text style={styles.sectionLabel}>their introduction</Text>
            {!!answers.intro_answer && <Text style={styles.answerIntro}>{answers.intro_answer}</Text>}
            {!!answers.area && <Text style={styles.answerLine}>from {answers.area}</Text>}
          </View>
        )}

        {!!answers?.guidelines_accepted_at && (
          <>
            <Text style={styles.sectionLabel}>consent</Text>
            <Text style={styles.answerLine}>
              accepted the community guidelines on {formatEventDateLA(answers.guidelines_accepted_at)}
            </Text>
          </>
        )}

        <Text style={styles.sectionLabel}>event history</Text>
        {historyLoading ? (
          <ActivityIndicator size="small" color={Colors.terracotta} style={{ marginTop: 8 }} />
        ) : history.length > 0 ? (
          <View style={{ gap: 8 }}>{history.map(renderHistoryRow)}</View>
        ) : (
          <Text style={styles.emptyText}>no tickets or RSVPs yet for this community&apos;s events.</Text>
        )}

        {member.role === 'member' && (
          <TouchableOpacity
            style={[styles.removeBtn, removing && styles.removeBtnBusy]}
            onPress={confirmRemove}
            disabled={removing}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${member.name ?? 'this member'} from the community`}
          >
            {removing ? (
              <ActivityIndicator size="small" color={Colors.errorRed} />
            ) : (
              <Text style={styles.removeBtnText}>remove from community</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  content: { padding: 20, gap: 10 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  face: { width: 56, height: 56, borderRadius: 28 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  name: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  roleTag: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 6,
  },
  answersCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginTop: 8,
  },
  answerIntro: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  answerLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  historyThumb: { width: 40, height: 40, borderRadius: 8 },
  historyThumbFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  historyBody: { flex: 1 },
  historyTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  historyMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  refundBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  refundBadgeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 4 },
  removeBtn: {
    marginTop: 28,
    marginBottom: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.errorRed,
    paddingVertical: 12,
    alignItems: 'center',
  },
  removeBtnBusy: { opacity: 0.6 },
  removeBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.errorRed },
});
