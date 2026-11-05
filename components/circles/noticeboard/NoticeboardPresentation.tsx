import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { CalendarDays, CalendarPlus, MessageCircle, UserPlus, Pencil, Image as ImageIcon } from 'lucide-react-native';
import Colors, { AfterglowColors, SceneDetailColors as Scene } from '../../../constants/Colors';
import type { AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_HOME } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import type { CirclePayload } from '../../../lib/circles/types';
import type { CirclePlanRow } from '../../../hooks/useCirclePlans';
import { formatPlanWhenLA } from '../../../lib/planTime';
import CircleMembersRow from '../CircleMembersRow';
import { CreatorActionFill } from '../../creator/CreatorActionFill';
import { GoldSurfaceFill } from '../../creator/GoldSurfaceFill';
import { styles, recentStyles, noticeboardAppearance } from './noticeboardStyles';

export type Appearance = { fonts: AfterglowFontFamilies };

export function PlanRow({
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

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function ActionButton({
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

type StagedProps = {
  payload: CirclePayload; title: string; appearance: Appearance; manualCover: string | null; livingCover: string | null;
  signed: Record<string, string>; plans: CirclePlanRow[]; loading: boolean; failed: boolean; onRetry: () => void;
  onOpenPlan: (id: string) => void; onAddPeople?: () => void; onNameCircle?: () => void; onPostPlan?: () => void; onOpenChat?: () => void;
  onEditCover?: () => void;
};
export function StagedNoticeboard({ payload, title, appearance, manualCover, livingCover, signed, plans, loading, failed, onRetry, onOpenPlan, onAddPeople, onNameCircle, onPostPlan, onOpenChat, onEditCover }: StagedProps) {
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
