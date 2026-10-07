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
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CalendarDays, CalendarPlus, MessageCircle, UserPlus, Pencil, Image as ImageIcon } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors, SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { CIRCLE_HOME, TYPE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import { useCirclePlans, CirclePlanRow } from '../../hooks/useCirclePlans';
import { useSignedAlbumUrls } from '../../hooks/useSignedAlbumUrls';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import { formatPlanWhenLA } from '../../lib/planTime';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { GoldSurfaceFill } from '../creator/GoldSurfaceFill';

// Recently-together photo strip dimensions (named, no inline math in styles).
const RECENT_THUMB = 84;
const RECENT_THUMB_RADIUS = 12;
const RECENT_THUMB_GAP = 8;

function PlanRow({
  plan,
  capacity,
  onPress,
}: {
  plan: CirclePlanRow;
  // Present only on the next (pinned) plan, where get_circle gives the counts.
  capacity?: { filled: number; size: number };
  onPress: () => void;
}) {
  const isOpen = plan.circle_visibility === 'open';
  return (
    <Pressable style={styles.planRow} onPress={onPress}>
      <CalendarDays size={CIRCLE_HOME.emptyPlanIcon} color={Colors.terracotta} strokeWidth={1.75} />
      <View style={styles.planRowBody}>
        <Text style={styles.planTitle} numberOfLines={1}>{plan.title}</Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {formatPlanWhenLA(plan.start_time)}
          {plan.location_text ? `, ${plan.location_text}` : ''}
        </Text>
        {capacity && (
          <Text style={styles.planCapacity} numberOfLines={1}>
            {COPY.circlePlanCapacity(capacity.filled, capacity.size)}
          </Text>
        )}
      </View>
      {/* "up to N others welcome" only on opened-up plans; just-us stays private. */}
      {isOpen ? (
        plan.stranger_cap != null && (
          <View style={styles.openTag}>
            <Text style={styles.openTagText}>{COPY.circlePlanSeatsWelcome(plan.stranger_cap)}</Text>
          </View>
        )
      ) : (
        <View style={styles.privTag}><Text style={styles.privTagText}>{COPY.circlePlanPrivateTag}</Text></View>
      )}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ActionButton({
  icon: Icon, label, primary, grow, onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  primary?: boolean;
  grow?: boolean;
  onPress?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      android_ripple={{ color: Colors.border }}
      style={[
        styles.actionBtn,
        grow && styles.actionGrow,
        primary && styles.actionPrimary,
        pressed && styles.actionBtnPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon
        size={primary ? 20 : 18}
        color={primary ? Colors.white : Colors.terracotta}
        strokeWidth={1.75}
      />
      <Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

type Appearance = { fonts: AfterglowFontFamilies };
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
  const { data: signed = {} } = useSignedAlbumUrls(recentPhotos.map((p) => p.media_path));

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

type StagedProps = {
  payload: CirclePayload; title: string; appearance: Appearance; manualCover: string | null; livingCover: string | null;
  signed: Record<string, string>; plans: CirclePlanRow[]; loading: boolean; failed: boolean; onRetry: () => void;
  onOpenPlan: (id: string) => void; onAddPeople?: () => void; onNameCircle?: () => void; onPostPlan?: () => void; onOpenChat?: () => void;
  onEditCover?: () => void;
};
function StagedNoticeboard({ payload, title, appearance, manualCover, livingCover, signed, plans, loading, failed, onRetry, onOpenPlan, onAddPeople, onNameCircle, onPostPlan, onOpenChat, onEditCover }: StagedProps) {
  const { fonts } = appearance, s = useMemo(() => noticeboardAppearance(fonts), [fonts]);
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const actionWidth = Math.max(0, (contentWidth ?? width) - 40);
  // Keep secondary labels readable at narrow widths and accessibility sizes.
  // The primary remains full width; neither text nor hit height is squeezed.
  const stackSecondaryActions = actionWidth < 300 || fontScale > 1.15;
  const inviteWidth = stackSecondaryActions ? actionWidth : Math.max(112, Math.floor((actionWidth - 12) / 3));
  const planWidth = stackSecondaryActions ? actionWidth : actionWidth - inviteWidth - 12;
  const coverHeight = Math.max(164, Math.round(actionWidth * 192 / 350));
  const action = (label: string, Icon: typeof CalendarPlus, callback: (() => void) | undefined, buttonWidth: number, primary = false) => <Pressable onPress={callback} disabled={!callback}
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !callback }}>
    {({ pressed }) => (
      // Concrete inner frames avoid the native Pressable geometry regression.
      <View style={[s.action, { width: buttonWidth }, primary ? s.primary : s.secondary, !callback && s.disabled, pressed && s.pressed]}>
        {primary && <CreatorActionFill/>}
        <View style={s.actionContent}><Icon size={18} color={primary ? AfterglowColors.white : Scene.action}/><Text numberOfLines={1} style={[s.actionText, primary && s.primaryText]}>{label}</Text></View>
      </View>
    )}
  </Pressable>;
  return <View style={s.wrap} onLayout={event => {
    const next = event.nativeEvent.layout.width;
    if (Number.isFinite(next) && next > 0) setContentWidth(current => current === next ? current : next);
  }}>
    <NoticeboardIdentity key={JSON.stringify([payload.circle.id, manualCover, livingCover, title])} title={title} manual={manualCover} living={livingCover} appearance={appearance} height={coverHeight} onEditCover={onEditCover}/>
    <View style={s.identityBody}>
      <Text accessibilityRole="header" style={s.name}>{title || 'Your circle'}</Text>
      <Text style={s.meta}>{COPY.circleHomeMembers(payload.members.length)}</Text>
      {!!payload.circle.description?.trim() && <Text style={s.description}>{payload.circle.description.trim()}</Text>}
      {!!onNameCircle && <Pressable onPress={onNameCircle} style={s.nameAction} accessibilityRole="button" accessibilityLabel="Name this circle"><Pencil size={16} color={Scene.action}/><Text style={s.link}>Name this circle</Text></Pressable>}
    </View>
    <View style={s.actions}>
      {action('Open chat', MessageCircle, onOpenChat, actionWidth, true)}
      <View style={[s.secondaryActions, stackSecondaryActions && s.stackedActions]}>{action('Make a plan', CalendarPlus, onPostPlan, planWidth)}{action('Invite', UserPlus, onAddPeople, inviteWidth)}</View>
    </View>
    <View style={s.section}><Text accessibilityRole="header" style={s.sectionTitle}>Your people</Text><CircleMembersRow members={payload.members} appearance={appearance}/></View>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>Coming up</Text>
      {loading ? <View style={s.planFeedback} accessibilityLiveRegion="polite"><ActivityIndicator color={Scene.action}/><Text style={s.meta}>Loading plans…</Text></View> : failed ?
        <View style={s.planFeedback} accessibilityLiveRegion="polite"><Text style={s.feedbackTitle}>Couldn’t load plans.</Text><Text style={s.meta}>Try again to see what’s coming up.</Text><Pressable onPress={onRetry} style={s.retry} accessibilityRole="button" accessibilityLabel="Try again to load circle plans"><Text style={s.link}>Try again</Text></Pressable></View> : plans.length ?
        <View style={s.plans}>{plans.map(plan => {
          const pinned = payload.pinned_plan?.id === plan.id ? payload.pinned_plan : null;
          const validDate = Number.isFinite(new Date(plan.start_time).getTime());
          const when = validDate ? formatPlanWhenLA(plan.start_time) : null;
          const date = validDate ? new Date(plan.start_time) : null;
          const audience = plan.circle_visibility === 'open' ? plan.stranger_cap != null ? `Up to ${plan.stranger_cap} ${plan.stranger_cap === 1 ? 'other' : 'others'} welcome` : 'Open to the feed' : plan.circle_visibility === 'circle_only' ? 'Private to circle' : 'Circle plan';
          return <Pressable key={plan.id} onPress={() => onOpenPlan(plan.id)} accessibilityRole="button" accessibilityLabel={`View plan, ${plan.title}`}>
            {({ pressed }) => <View style={[s.plan, pressed && s.pressed]}>
              <View style={s.planSummary}>
                {date && <View style={s.dateBadge} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <GoldSurfaceFill radius={10}/>
                  <Text style={s.dateWeekday}>{date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).toUpperCase()}</Text>
                  <Text style={s.dateDay}>{date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })}</Text>
                </View>}
                <View style={s.planBody}>
                  <Text style={s.planTitle}>{plan.title}</Text>
                  {!!when && <Text style={s.planMeta}>{when}</Text>}
                  {!!plan.location_text?.trim() && <Text style={s.planMeta}>{plan.location_text.trim()}</Text>}
                </View>
              </View>
              <View style={s.planAudience}><Text style={s.audienceText}>{audience}</Text>{pinned && <Text style={s.capacity}>{pinned.circle_in_count} of {pinned.circle_size} circle members going</Text>}</View>
            </View>}
          </Pressable>;
        })}</View> : <View style={s.planFeedback}><Text style={s.feedbackTitle}>No plans yet</Text><Text style={s.planMeta}>Make a plan whenever you’re ready.</Text></View>}
    </View>
    {!!payload.recent_together.length && <View style={s.section}><Text accessibilityRole="header" style={s.sectionTitle}>Recently together</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recentRow} keyboardShouldPersistTaps="handled">
        {payload.recent_together.map(photo => <RecentPhoto key={JSON.stringify([payload.circle.id, photo.upload_id, signed[photo.media_path]])} uri={signed[photo.media_path] ?? null}/>)}
      </ScrollView>
    </View>}
  </View>;
}

function NoticeboardIdentity({ title, manual, living, appearance, height, onEditCover }: { title: string; manual: string | null; living: string | null; appearance: Appearance; height: number; onEditCover?: () => void }) {
  const [failed, setFailed] = useState<string[]>([]), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const uri = [manual, living].find(value => !!value && !failed.includes(value));
  const s = useMemo(() => noticeboardAppearance(appearance.fonts), [appearance.fonts]);
  const label = manual || living ? 'Edit cover' : 'Add cover';
  return <View style={[s.cover, { minHeight: height }, uri ? s.photoCover : s.emptyCover]}>
    {uri ? <Image source={{ uri }} style={s.coverPhoto} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} accessible={false}
      onError={() => { if (mounted.current) setFailed(values => values.includes(uri) ? values : [...values, uri]); }}/> : <>
      <GoldSurfaceFill radius={16}/>
      <Text style={s.coverInitial} accessible={false}>{Array.from(title.trim())[0]?.toUpperCase() ?? '?'}</Text>
    </>}
    {!!onEditCover && <View style={uri ? s.coverEditPosition : s.coverAddPosition}>
      <Pressable onPress={onEditCover} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => <View style={[s.coverEditFrame, pressed && s.pressed]}>
          {uri ? <Pencil size={16} color={Scene.action}/> : <ImageIcon size={16} color={Scene.action}/>}
          <Text numberOfLines={1} style={s.coverEditText}>{label}</Text>
        </View>}
      </Pressable>
    </View>}
  </View>;
}
function RecentPhoto({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <View style={recentStyles.frame} accessible accessibilityRole="image" accessibilityLabel={uri && !failed ? 'Recent shared photo' : 'Shared photo unavailable'}>
    {uri && !failed ? <Image source={{ uri }} style={recentStyles.photo} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} accessible={false}
      onError={() => { if (mounted.current) setFailed(true); }}/> : <ImageIcon size={22} color={AfterglowColors.muted}/>}
  </View>;
}
const recentStyles = StyleSheet.create({
  frame: { width: 84, height: 84, borderRadius: 5, overflow: 'hidden', backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 84, height: 84, opacity: 1 },
});
function noticeboardAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  // Parent owns the continuous Scene sunset background and safe-area header.
  wrap: { paddingTop: 8, paddingBottom: 24 },
  cover: { marginHorizontal: 20, borderRadius: 16, overflow: 'hidden', backgroundColor: CreatorSurfaceColors.sunsetGoldMiddle },
  photoCover: { justifyContent: 'flex-end' },
  emptyCover: { alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  coverPhoto: { ...StyleSheet.absoluteFillObject, opacity: 1 },
  coverInitial: { fontSize: FontSizes.displayXL, lineHeight: LineHeights.displayXL, fontFamily: fonts.display, color: Scene.text },
  coverEditPosition: { alignSelf: 'flex-end', maxWidth: '100%', padding: 12 },
  coverAddPosition: { maxWidth: '100%' },
  coverEditFrame: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: Scene.surface, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
  coverEditText: { ...AfterglowType.body, fontFamily: fonts.medium, color: Scene.text, flexShrink: 1, textAlign: 'center' },
  identityBody: { paddingHorizontal: 20, paddingTop: 12 },
  name: { ...AfterglowType.identity, fontFamily: fonts.display, color: Scene.text },
  meta: { ...AfterglowType.section, fontFamily: fonts.regular, color: Scene.supporting, marginTop: 4 },
  description: { ...AfterglowType.body, fontFamily: fonts.regular, color: Scene.supporting, marginTop: 8 },
  nameAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4 },
  link: { ...AfterglowType.body, fontFamily: fonts.medium, color: Scene.action, flexShrink: 1 },
  actions: { marginHorizontal: 20, marginTop: 18, marginBottom: 24, gap: 12 },
  secondaryActions: { flexDirection: 'row', gap: 12 },
  stackedActions: { flexDirection: 'column' },
  actionContent: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, minWidth: 0 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingVertical: 12, paddingHorizontal: 16 },
  primary: { backgroundColor: Scene.action, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge },
  secondary: { backgroundColor: Scene.surface, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
  actionText: { ...AfterglowType.body, fontFamily: fonts.medium, color: Scene.text, flexShrink: 1, textAlign: 'center' },
  primaryText: { color: AfterglowColors.white }, disabled: { opacity: 0.55 }, pressed: { opacity: 0.8 },
  section: { marginBottom: 24 }, sectionTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.medium, color: Scene.text, marginHorizontal: 20, marginBottom: 14 },
  plans: { marginHorizontal: 20, gap: 10 },
  plan: { minHeight: 44, padding: 14, gap: 4, borderRadius: 16, backgroundColor: Scene.surface, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
  planSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planBody: { flex: 1, minWidth: 0, gap: 4 },
  dateBadge: { minWidth: 40, minHeight: 48, paddingHorizontal: 6, paddingVertical: 6, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dateWeekday: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Scene.supporting },
  dateDay: { ...AfterglowType.pageSection, fontFamily: fonts.medium, color: Scene.text },
  planTitle: { ...AfterglowType.body, fontFamily: fonts.medium, color: Scene.text },
  planMeta: { ...AfterglowType.section, fontFamily: fonts.regular, color: Scene.supporting, flexShrink: 1 },
  planAudience: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.subtleLine, paddingTop: 8, marginTop: 6, gap: 8, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  audienceText: { ...AfterglowType.caption, fontFamily: fonts.medium, color: Scene.action },
  capacity: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Scene.supporting },
  planFeedback: { marginHorizontal: 20, borderWidth: 1, borderColor: AfterglowColors.subtleLine, padding: 16, borderRadius: 16, backgroundColor: Scene.surface, alignItems: 'flex-start', gap: 8 },
  feedbackTitle: { ...AfterglowType.body, fontFamily: fonts.medium, color: Scene.text },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: Scene.border, borderRadius: 999, marginTop: 4 },
  recentRow: { paddingHorizontal: 20, gap: 8 },
}); }

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: CIRCLE_HOME.sectionGapV },
  hero: {
    alignItems: 'center',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: 12,
  },
  coverHero: {
    height: 180,
    marginBottom: 12,
    justifyContent: 'flex-end',
  },
  coverImg: { ...StyleSheet.absoluteFillObject },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayDark55,
  },
  coverName: {
    ...TYPE.heroDisplay,
    color: Colors.creamHigh,
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    paddingBottom: 12,
  },
  name: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginTop: 12,
  },
  metaWrap: {
    alignItems: 'center',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  memberCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 10,
  },
  nameCircle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  nameCircleText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  actionCol: {
    gap: 10,
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  actionRowSecondary: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.cardBg,
  },
  actionGrow: { flex: 1 },
  actionContent: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionPrimary: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
    paddingVertical: 14,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  actionBtnPressed: { opacity: 0.7 },
  actionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  actionPrimaryText: { color: Colors.white, fontSize: FontSizes.bodyMD },
  section: { marginBottom: CIRCLE_HOME.sectionGapV },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: CIRCLE_HOME.sectionLabelGap,
    marginHorizontal: CIRCLE_HOME.sectionPadH,
  },
  planEmpty: {
    marginHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'flex-start',
    gap: 10,
  },
  makeFirstPlan: {
    backgroundColor: Colors.goldAccent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  makeFirstPlanPressed: { opacity: 0.8 },
  makeFirstPlanText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  planList: { marginHorizontal: CIRCLE_HOME.sectionPadH, gap: 8 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  planRowBody: { flex: 1, minWidth: 0 },
  planTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  planMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 3 },
  planCapacity: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 3 },
  openTag: { backgroundColor: Colors.goldenAmberTint15, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  openTagText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.darkWarm, letterSpacing: 0.2 },
  privTag: { backgroundColor: Colors.dividerWarm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  privTagText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.secondary, letterSpacing: 0.2 },
  planEmptyTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  recentRow: {
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    gap: RECENT_THUMB_GAP,
  },
  recentThumb: {
    width: RECENT_THUMB,
    height: RECENT_THUMB,
    borderRadius: RECENT_THUMB_RADIUS,
    overflow: 'hidden',
  },
  recentImg: {
    width: RECENT_THUMB,
    height: RECENT_THUMB,
    borderRadius: RECENT_THUMB_RADIUS,
  },
  recentSkeleton: { backgroundColor: Colors.dividerWarm },
});
