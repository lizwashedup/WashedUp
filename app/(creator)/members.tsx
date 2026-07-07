/**
 * Creator mode: members. The join approval loop (approve / decline pending
 * requests) plus the active member directory with remove. Leader powers are
 * enforced server-side by RLS; this screen is just the surface.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Check, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import {
  getCreatorAccess,
  getCommunityMembers,
  getJoinAnswersByMember,
  reviewJoinRequest,
  removeMember,
  type CommunityMemberRow,
} from '../../lib/creatorMode';

export default function CreatorMembersScreen() {
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = access?.ledCommunities[0] ?? null;

  const { data: members = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-members', community?.id],
    queryFn: () => getCommunityMembers(community!.id),
    enabled: !!community,
  });

  // private join answers, leader-eyes-only by RLS (community_member_answers)
  const { data: answersByMember } = useQuery({
    queryKey: ['join-answers', community?.id],
    queryFn: () => getJoinAnswersByMember(community!.id),
    enabled: !!community,
  });

  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');

  const act = async (fn: () => Promise<void>, id: string) => {
    setActingId(id);
    try {
      await fn();
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['creator-members', community?.id] });
    } catch (e) {
      setAlertInfo({ title: 'That did not work', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setActingId(null);
    }
  };

  // guard against the accidental decline: it notifies and blocks a re-ask
  const confirmDecline = (m: CommunityMemberRow) => {
    hapticLight();
    setAlertInfo({
      title: `Decline ${m.name ?? 'this request'}?`,
      message: 'They get a kind note, and they cannot ask again for now.',
      buttons: [
        { text: 'Keep it pending', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => act(() => reviewJoinRequest(m.id, false), m.id) },
      ],
    });
  };

  const confirmRemove = (m: CommunityMemberRow) => {
    hapticLight();
    setAlertInfo({
      title: `Remove ${m.name ?? 'this member'}?`,
      message: 'They lose access to the community and its chat.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => act(() => removeMember(m.id), m.id) },
      ],
    });
  };

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

          {pending.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>wants in ({pending.length})</Text>
              {pending.map((m) => {
                const answers = answersByMember?.get(m.id);
                const expanded = expandedId === m.id;
                return (
                  <View key={m.id} style={[styles.row, styles.rowPending, styles.rowColumn]}>
                    <View style={styles.rowTop}>
                      <TouchableOpacity
                        style={styles.rowTopTap}
                        onPress={() => { hapticLight(); setExpandedId(expanded ? null : m.id); }}
                      >
                        <MemberFace m={m} />
                        <View style={styles.rowTopText}>
                          <Text style={styles.rowName}>
                            {answers ? `${answers.first_name ?? ''} ${answers.last_name ?? ''}`.trim() || (m.name ?? 'someone') : m.name ?? 'someone'}
                          </Text>
                          <Text style={styles.rowMeta}>
                            asked {new Date(m.created_at).toLocaleDateString()}
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
                            onPress={() => act(() => reviewJoinRequest(m.id, true), m.id)}
                            hitSlop={8}
                          >
                            <Check size={18} color={Colors.white} strokeWidth={2.5} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roundBtn, styles.declineBtn]}
                            onPress={() => confirmDecline(m)}
                            hitSlop={8}
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
                        <Text style={styles.answerLabel}>only you see these</Text>
                        <Text style={styles.answerLine}>{answers.email ?? 'no email'}</Text>
                        <Text style={styles.answerLine}>zip {answers.zip ?? 'unknown'}</Text>
                        {!!answers.guidelines_accepted_at && (
                          <Text style={styles.answerLine}>
                            accepted the guidelines {new Date(answers.guidelines_accepted_at).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          <Text style={[styles.sectionLabel, { marginTop: pending.length ? 20 : 0 }]}>
            in the community ({active.length})
          </Text>
          {active.map((m) => (
            <View key={m.id} style={styles.row}>
              <MemberFace m={m} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>
                  {m.name ?? 'someone'}
                  {/* LIZ COPY (decision 16): community creator; co-runner placeholder */}
                  {m.role !== 'member' && (
                    <Text style={styles.roleTag}>
                      {m.role === 'leader' ? ' · community creator' : ' · helps run it'}
                    </Text>
                  )}
                </Text>
                <Text style={styles.rowMeta}>
                  joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : 'recently'}
                </Text>
              </View>
              {m.role === 'member' && (
                <TouchableOpacity onPress={() => confirmRemove(m)} hitSlop={8}>
                  <Text style={styles.removeLink}>remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {active.length === 0 && pending.length === 0 && (
            <Text style={styles.empty}>share your page and the first faces show up here.</Text>
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
});
