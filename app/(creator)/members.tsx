/**
 * Creator mode: members. The join approval loop (approve / decline pending
 * requests) plus the active member directory with remove. Leader powers are
 * enforced server-side by RLS; this screen is just the surface.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, RefreshControl, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Check, X, ChevronRight, Search } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CO_CREATOR_INVITES_ENABLED } from '../../constants/FeatureFlags';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import { formatEventDateLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';
import {
  getCreatorAccess,
  getCommunityMembers,
  getRemovedCommunityMembers,
  getJoinAnswerCards,
  isLeaderAccess,
  canManageMembers,
  creatorLandingRoute,
  coCreatorRoleTag,
  reviewJoinRequest,
  removeMember,
  membersToCsv,
  type CommunityMemberRow,
} from '../../lib/creatorMode';

export default function CreatorMembersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const { data: members = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-members', community?.id],
    queryFn: () => getCommunityMembers(community!.id),
    enabled: !!community,
  });
  const [query, setQuery] = useState('');

  const { data: removed = [] } = useQuery({
    queryKey: ['creator-members-removed', community?.id],
    queryFn: () => getRemovedCommunityMembers(community!.id),
    enabled: !!community,
  });
  const [showRemoved, setShowRemoved] = useState(false);

  // private join answers, leader-eyes-only by RLS (community_member_answers)
  // the proposal-42 bridge: the projection RPC once 42 lands, the leader
  // table read until then — one card shape either way, never email/raw zip
  const { data: answersByMember } = useQuery({
    queryKey: ['join-answer-cards', community?.id],
    queryFn: () => getJoinAnswerCards(community!.id),
    enabled: !!community,
  });

  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');
  const q = query.trim().toLowerCase();
  const visiblePending = q ? pending.filter((m) => (m.name ?? '').toLowerCase().includes(q)) : pending;
  const visibleActive = q ? active.filter((m) => (m.name ?? '').toLowerCase().includes(q)) : active;

  const act = async (fn: () => Promise<void>, id: string) => {
    setActingId(id);
    try {
      await fn();
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['creator-members', community?.id] });
      queryClient.invalidateQueries({ queryKey: ['creator-members-removed', community?.id] });
    } catch (e) {
      setAlertInfo({ title: 'That did not work', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setActingId(null);
    }
  };

  // C-13: guard against the accidental approve, same shape as confirmDecline
  // below -- approving activates the member immediately, drops their intro
  // into the community chat, and sends them a notification, none of which
  // can be reversed from the client today.
  const confirmApprove = (m: CommunityMemberRow) => {
    hapticLight();
    setAlertInfo({
      title: `Approve ${m.name ?? 'this request'}?`,
      message: "They'll join the community chat right away and their introduction posts there.",
      buttons: [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Approve', onPress: () => act(() => reviewJoinRequest(m.id, true), m.id) },
      ],
    });
  };

  // guard against the accidental decline: it notifies and blocks a re-ask
  const confirmDecline = (m: CommunityMemberRow) => {
    hapticLight();
    setAlertInfo({
      title: `Decline ${m.name ?? 'this request'}?`,
      message: 'They get a kind note, and they cannot ask again for now.',
      buttons: [
        { text: 'Keep it pending', style: 'cancel' },
        { text: 'Decline', onPress: () => act(() => reviewJoinRequest(m.id, false), m.id) },
      ],
    });
  };

  // inventory C-10: real export, native's own share sheet (mail, files,
  // Messages, etc) instead of a download route that does not exist on
  // mobile. Active members only, same fields the roster already shows.
  const handleExport = async () => {
    if (active.length === 0) return;
    hapticLight();
    try {
      await Share.share({ message: membersToCsv(members) });
    } catch (e) {
      setAlertInfo({ title: 'That did not share', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  const confirmRemove = (m: CommunityMemberRow) => {
    hapticLight();
    setAlertInfo({
      title: `Remove ${m.name ?? 'this member'}?`,
      message: 'They lose access to the community and its chat.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', onPress: () => act(() => removeMember(m.id), m.id) },
      ],
    });
  };

  // members is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.3). The layout hides the tab; this covers stale pushes and
  // deep links.
  if (access && !isLeaderAccess(access) && !canManageMembers(access)) return <Redirect href={creatorLandingRoute(access)} />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.title}>members</Text>
          <CommunitySwitcher access={access} />

          {CO_CREATOR_INVITES_ENABLED && (
            <TouchableOpacity
              style={styles.coCreatorsCard}
              onPress={() => router.push('/creator/co-creators')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Co-creators"
              accessibilityHint="Invite someone to help run this community."
            >
              <View style={styles.coCreatorsCardText}>
                <Text style={styles.coCreatorsCardTitle}>Co-creators</Text>
                <Text style={styles.coCreatorsCardHint}>Invite someone to help run this community.</Text>
              </View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>
          )}

          {(pending.length > 0 || active.length > 0) && (
            <View style={styles.searchRow}>
              <Search size={16} color={Colors.tertiary} strokeWidth={2.25} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="search members"
                placeholderTextColor={Colors.tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="search members by name"
              />
            </View>
          )}

          {pending.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>wants in ({pending.length})</Text>
              {visiblePending.map((m) => {
                const answers = answersByMember?.get(m.id);
                const expanded = expandedId === m.id;
                return (
                  <View key={m.id} style={[styles.row, styles.rowPending, styles.rowColumn]}>
                    <View style={styles.rowTop}>
                      <TouchableOpacity
                        style={styles.rowTopTap}
                        onPress={() => { hapticLight(); setExpandedId(expanded ? null : m.id); }}
                        accessibilityRole="button"
                        accessibilityLabel={`${m.name ?? 'Someone'}, asked ${formatEventDateLA(m.created_at)}`}
                        accessibilityHint={answers ? (expanded ? 'Collapse their answers' : 'Show their answers') : undefined}
                        accessibilityState={answers ? { expanded } : undefined}
                      >
                        <MemberFace m={m} />
                        <View style={styles.rowTopText}>
                          <Text style={styles.rowName}>
                            {answers ? `${answers.first_name ?? ''} ${answers.last_name ?? ''}`.trim() || (m.name ?? 'someone') : m.name ?? 'someone'}
                          </Text>
                          <Text style={styles.rowMeta}>
                            asked {formatEventDateLA(m.created_at)}
                            {answers ? '  tap for their answers' : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {actingId === m.id ? (
                        <ActivityIndicator size="small" color={Colors.terracotta} />
                      ) : (
                        <View style={styles.actionPair}>
                          <TouchableOpacity
                            style={[styles.roundBtn, styles.approveBtn]}
                            onPress={() => confirmApprove(m)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Approve ${m.name ?? 'this request'}`}
                          >
                            <Check size={18} color={Colors.white} strokeWidth={2.5} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roundBtn, styles.declineBtn]}
                            onPress={() => confirmDecline(m)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Decline ${m.name ?? 'this request'}`}
                          >
                            <X size={18} color={Colors.secondary} strokeWidth={2.5} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {expanded && answers && (
                      <View style={styles.answers}>
                        {!!answers.intro_answer && (
                          <>
                            <Text style={styles.answerLabel}>their introduction</Text>
                            <Text style={styles.answerIntro}>{answers.intro_answer}</Text>
                          </>
                        )}
                        {/* email and raw zip never reach this view (Liz's
                            call, doc 13; server-enforced once proposal 42
                            lands): name, AREA, and the intro only. Unknown
                            zip -> the line simply does not render (the
                            intro-card treatment). */}
                        {!!answers.area && (
                          <Text style={styles.answerLine}>from {answers.area}</Text>
                        )}
                        {!!answers.guidelines_accepted_at && (
                          <Text style={styles.answerLine}>
                            accepted the guidelines {formatEventDateLA(String(answers.guidelines_accepted_at))}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { marginTop: pending.length ? 20 : 0 }]}>
              in the community ({active.length})
            </Text>
            {active.length > 0 && (
              <TouchableOpacity
                onPress={handleExport}
                hitSlop={12}
                style={{ marginTop: pending.length ? 20 : 0 }}
                accessibilityRole="button"
                accessibilityLabel="Export the member list"
              >
                {/* LIZ COPY */}
                <Text style={styles.exportLink}>export</Text>
              </TouchableOpacity>
            )}
          </View>
          {visibleActive.map((m) => (
            <View key={m.id} style={styles.row}>
              <TouchableOpacity
                style={styles.rowTopTap}
                onPress={() => { hapticLight(); router.push(`/creator/member/${m.id}` as never); }}
                accessibilityRole="button"
                accessibilityLabel={`View ${m.name ?? 'member'}'s details`}
              >
                <MemberFace m={m} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>
                    {m.name ?? 'someone'}
                    {/* LIZ COPY (decision 16): community creator; co-runner placeholder */}
                    {m.role !== 'member' && (
                      <Text style={styles.roleTag}>{coCreatorRoleTag(m.role)}</Text>
                    )}
                  </Text>
                  <Text style={styles.rowMeta}>
                    joined {m.joined_at ? formatEventDateLA(m.joined_at) : 'recently'}
                  </Text>
                </View>
              </TouchableOpacity>
              {m.role === 'member' && (
                <TouchableOpacity
                  onPress={() => confirmRemove(m)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.name ?? 'this member'}`}
                >
                  <Text style={styles.removeLink}>remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {removed.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => { hapticLight(); setShowRemoved((v) => !v); }}
                style={styles.removedToggle}
                accessibilityRole="button"
                accessibilityLabel={showRemoved ? 'hide removed members' : `show ${removed.length} removed member${removed.length === 1 ? '' : 's'}`}
                accessibilityState={{ expanded: showRemoved }}
              >
                <Text style={styles.removedToggleText}>{showRemoved ? 'hide' : 'show'} removed ({removed.length})</Text>
              </TouchableOpacity>
              {showRemoved && removed.map((m) => (
                <View key={m.id} style={[styles.row, styles.rowRemoved]}>
                  <MemberFace m={m} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{m.name ?? 'someone'}</Text>
                    <Text style={styles.rowMeta}>{m.status === 'banned' ? 'banned' : 'removed'}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {active.length === 0 && pending.length === 0 && (
            <Text style={styles.empty}>share your page and the first faces show up here.</Text>
          )}
          {q.length > 0 && visiblePending.length === 0 && visibleActive.length === 0 && (pending.length > 0 || active.length > 0) && (
            <Text style={styles.empty}>no one matches that search.</Text>
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
  );
}

function MemberFace({ m }: { m: CommunityMemberRow }) {
  return m.photo_url ? (
    <Image source={{ uri: m.photo_url }} style={styles.face} contentFit="cover" />
  ) : (
    <View style={[styles.face, styles.facePlaceholder]}>
      <Text style={styles.faceInitial}>{(m.name ?? '?').slice(0, 1).toLowerCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 10 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exportLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  rowPending: { borderColor: Colors.gold, borderWidth: 1.5 },
  rowColumn: { flexDirection: 'column', alignItems: 'stretch' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTopTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTopText: { flex: 1 },
  answers: { marginTop: 12, gap: 4 },
  answerLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginTop: 6,
  },
  answerIntro: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  answerLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  face: { width: 40, height: 40, borderRadius: 20 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  rowName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  roleTag: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta },
  rowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  actionPair: { flexDirection: 'row', gap: 8 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  approveBtn: { backgroundColor: Colors.terracotta },
  declineBtn: { backgroundColor: Colors.inputBg },
  removeLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 12 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.cardBg, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 4,
  },
  searchInput: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  removedToggle: { marginTop: 20, paddingVertical: 4 },
  removedToggleText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  rowRemoved: { opacity: 0.6 },
  coCreatorsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
    marginBottom: 16,
  },
  coCreatorsCardText: { flex: 1, gap: 2 },
  coCreatorsCardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  coCreatorsCardHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
});
