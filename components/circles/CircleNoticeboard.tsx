/**
 * CircleNoticeboard - retains the original Circle data and action contracts.
 * The inspected conversation-first appearance is implemented in StagedNoticeboard.
 * Legacy presentation:
 * identity hero (cover photo when set, else serif monogram tile), an
 * UNCONDITIONAL action row (post a plan / open chat / invite), the members row,
 * and "coming up" plans with a "Make the first plan." nudge when empty.
 *
 * The cover follows the identity ladder: a manual cover (buildCircleCoverUrl) >
 * the living cover (the newest get_circle().recent_together photo, signed) >
 * the serif monogram tile. RECENTLY TOGETHER shows the circle's recent shared
 * plan-album photos as a strip. The pinned-plan capacity line lands in its
 * own pass.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CalendarPlus, MessageCircle, UserPlus, Pencil } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import { useCirclePlans } from '../../hooks/useCirclePlans';
import { useSignedAlbumUrls } from '../../hooks/useSignedAlbumUrls';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';
import { PlanRow, SectionLabel, ActionButton, StagedNoticeboard, type Appearance } from './noticeboard/NoticeboardPresentation';
import { styles } from './noticeboard/noticeboardStyles';

export type CircleNoticeboardProps = {
  payload: CirclePayload; displayName?: string; onAddPeople?: () => void; onNameCircle?: () => void;
  onPostPlan?: () => void; onOpenChat?: () => void; appearance?: Appearance;
  /** Supplied only by the current admin-scoped parent; does not grant editing. */
  onEditCover?: () => void;
  operationScope?: { isCurrent: () => boolean }; onOpenPlan?: (planId: string) => void;
  plansScope?: { userId: string; epoch: number; isCurrent: () => boolean };
};
export default function CircleNoticeboard({
  payload,
  displayName,
  onAddPeople,
  onNameCircle,
  onPostPlan,
  onOpenChat,
  onEditCover,
  appearance, operationScope, onOpenPlan, plansScope,
}: CircleNoticeboardProps) {
  const { circle, members } = payload;
  const router = useRouter();
  const plansQuery = useCirclePlans(circle.id, plansScope);
  const { data: plans = [] } = plansQuery;
  const entry = useMemo(() => ({ id: circle.id, operationScope }), [circle.id, operationScope, plansScope?.userId, plansScope?.epoch]);
  const active = useRef<typeof entry | null>(null), currentEntry = useRef(entry); currentEntry.current = entry;
  const callbacks = useRef({ onAddPeople, onNameCircle, onPostPlan, onOpenChat, onEditCover, onOpenPlan, plans, failed: plansQuery.isError });
  callbacks.current = { onAddPeople, onNameCircle, onPostPlan, onOpenChat, onEditCover, onOpenPlan, plans, failed: plansQuery.isError };
  useLayoutEffect(() => { active.current = entry; return () => { if (active.current === entry) active.current = null; }; }, [entry]);
  const current = () => active.current === entry && currentEntry.current === entry && (!operationScope || operationScope.isCurrent());
  const call = (name: 'onAddPeople' | 'onNameCircle' | 'onPostPlan' | 'onOpenChat' | 'onEditCover') => { if (current()) callbacks.current[name]?.(); };
  const openPlan = (id: string) => {
    if (!current() || callbacks.current.failed || !callbacks.current.plans.some(plan => plan.id === id)) return;
    if (callbacks.current.onOpenPlan) callbacks.current.onOpenPlan(id); else router.push(`/plan/${id}` as never);
  };
  const readLock = useRef<{ entry: typeof entry } | null>(null), [retrying, setRetrying] = useState<typeof entry | null>(null);
  const retry = async () => {
    if (!current() || readLock.current?.entry === entry || plansQuery.isFetching) return;
    const attempt = { entry }; readLock.current = attempt; setRetrying(entry);
    try { await plansQuery.refetch(); } catch { /* Query exposes its actual failure. */ }
    finally { if (readLock.current === attempt) readLock.current = null; if (current()) setRetrying(null); }
  };
  // A cached empty list is not a confirmed empty result while its refresh is
  // pending, particularly when checking an uncertain plan creation. Keep
  // already-readable rows visible during an ordinary background refresh.
  const plansLoading = plansQuery.isLoading || retrying === entry ||
    (plans.length === 0 && plansQuery.isFetching);
  const title = displayName?.trim() || circle.name;
  // The next upcoming plan carries the capacity counts (get_circle.pinned_plan);
  // matched into the list by id so only that row shows "{filled} of {size} in".
  const pinned = payload.pinned_plan;

  // Sign every recent-together photo once; the strip and the living cover both
  // read from this map (album-media is private, so paths need signed URLs).
  const recentPhotos = payload.recent_together;
  const { data: signed = {} } = useSignedAlbumUrls(recentPhotos.map((p) => p.media_path), plansScope);

  // Identity ladder: a manual cover wins; with none, the living cover is the
  // newest shared photo; with neither, CircleCover falls to the serif monogram.
  const manualCoverUrl = buildCircleCoverUrl(circle.id, circle.cover_upload_id);
  const livingPath = manualCoverUrl ? null : recentPhotos[0]?.media_path ?? null;
  const coverUrl = manualCoverUrl ?? (livingPath ? signed[livingPath] ?? null : null);
  const [firstPlanPressed, setFirstPlanPressed] = useState(false);

  if (appearance) return <StagedNoticeboard payload={payload} title={title} appearance={appearance} manualCover={manualCoverUrl}
    livingCover={recentPhotos[0] ? signed[recentPhotos[0].media_path] ?? null : null} signed={signed} plans={plans}
    loading={plansLoading} failed={plansQuery.isError} onRetry={() => { void retry(); }}
    onOpenPlan={openPlan} onAddPeople={onAddPeople ? () => call('onAddPeople') : undefined}
    onNameCircle={onNameCircle ? () => call('onNameCircle') : undefined} onPostPlan={onPostPlan ? () => call('onPostPlan') : undefined}
    onOpenChat={onOpenChat ? () => call('onOpenChat') : undefined}
    onEditCover={onEditCover ? () => call('onEditCover') : undefined}/>;

  return (
    <View style={styles.wrap}>
      {/* Identity hero: cover photo when set, else serif monogram tile. */}
      {coverUrl ? (
        <View style={styles.coverHero}>
          <Image source={{ uri: coverUrl }} style={styles.coverImg} contentFit="cover" />
          <View style={styles.coverScrim} />
          <Text style={styles.coverName} numberOfLines={2}>{title}</Text>
        </View>
      ) : (
        <View style={styles.hero}>
          <CircleCover
            name={title}
            coverUrl={null}
            size={CIRCLE_HOME.coverHero}
            radius={CIRCLE_HOME.coverHeroRadius}
            monogramSize={CIRCLE_HOME.coverMonogram}
          />
          <Text style={styles.name} numberOfLines={2}>{title}</Text>
        </View>
      )}

      <View style={styles.metaWrap}>
        <Text style={styles.memberCount}>{COPY.circleHomeMembers(members.length)}</Text>
        {!!circle.description?.trim() && (
          <Text style={styles.description}>{circle.description.trim()}</Text>
        )}
        {!!onNameCircle && (
          <Pressable
            onPress={() => call('onNameCircle')}
            android_ripple={{ color: Colors.border }}
            style={styles.nameCircle}
            accessibilityRole="button"
            accessibilityLabel={COPY.circleNameThis}
          >
            <Pencil size={CIRCLE_HOME.nameIcon} color={Colors.terracotta} strokeWidth={1.75} />
            <Text style={styles.nameCircleText}>{COPY.circleNameThis}</Text>
          </Pressable>
        )}
      </View>

      {/* Action area: "post a plan" is the circle's one dominant CTA (full-width
          terracotta); chat + invite ride below as a lighter secondary pair. */}
      <View style={styles.actionCol}>
        <ActionButton icon={CalendarPlus} label={COPY.circleActionPost} primary onPress={() => call('onPostPlan')} />
        <View style={styles.actionRowSecondary}>
          <ActionButton icon={MessageCircle} label={COPY.circleActionChat} grow onPress={() => call('onOpenChat')} />
          <ActionButton icon={UserPlus} label={COPY.circleActionInvite} grow onPress={() => call('onAddPeople')} />
        </View>
      </View>

      {/* Members */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circleWhoLabel}</SectionLabel>
        <CircleMembersRow members={members} onAdd={onAddPeople ? () => call('onAddPeople') : undefined} />
      </View>

      {/* Plans on the calendar */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circlePlansLabel}</SectionLabel>
        {plansLoading ? <View style={styles.planEmpty} accessibilityLiveRegion="polite"><ActivityIndicator color={Colors.terracotta}/><Text style={styles.planMeta}>Loading plans…</Text></View> : plansQuery.isError ?
          <View style={styles.planEmpty}><Text style={styles.planEmptyTitle}>Couldn’t load plans.</Text><Pressable onPress={() => { void retry(); }} accessibilityRole="button" accessibilityLabel="Try again to load circle plans" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.nameCircleText}>Try again</Text></Pressable></View> : plans.length === 0 ? (
          <View style={styles.planEmpty}>
            <Text style={styles.planEmptyTitle}>{COPY.circlePlansEmpty}</Text>
            <Pressable
              onPress={() => call('onPostPlan')}
              onPressIn={() => setFirstPlanPressed(true)}
              onPressOut={() => setFirstPlanPressed(false)}
              android_ripple={{ color: Colors.border }}
              style={[styles.makeFirstPlan, firstPlanPressed && styles.makeFirstPlanPressed]}
              accessibilityRole="button"
              accessibilityLabel={COPY.circleMakeFirstPlan}
            >
              <Text style={styles.makeFirstPlanText}>{COPY.circleMakeFirstPlan}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.planList}>
            {plans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                capacity={
                  pinned && pinned.id === p.id
                    ? { filled: pinned.circle_in_count, size: pinned.circle_size }
                    : undefined
                }
                onPress={() => openPlan(p.id)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Recently together: the circle's recent shared plan-album photos. */}
      {recentPhotos.length > 0 && (
        <View style={styles.section}>
          <SectionLabel>{COPY.circleRecentLabel}</SectionLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recentPhotos.map((photo) => {
              const uri = signed[photo.media_path];
              return (
                <View key={photo.upload_id} style={styles.recentThumb}>
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={styles.recentImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.recentImg, styles.recentSkeleton]} />
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Pinned-plan capacity line lands in its own pass. */}
    </View>
  );
}
