import { requestWithDeadline } from '../../../lib/requestWithDeadline';
/**
 * CirclePlanComposer - the "Make a plan" sheet, opened from a circle chat or a
 * DM (never from inside an individual plan chat). A circle plan is a real
 * events row created via create_circle_plan. Gated upstream by GROUPS_ENABLED.
 *
 * The sheet carries the standard plan fields (what / where / when) above the
 * one circle-specific question, WHO IS THIS FOR, which quietly sets both the
 * audience and whether the plan gets its own chat:
 *   Just us  + everyone  -> circle_only, lives in the circle chat (no new chat)
 *   Just us  + pick people -> circle_only, its own chat for the picked subset
 *   Open it up           -> open, posts to the public feed, its own chat
 *
 * PlacePicker supplies the place name to the existing location_text payload;
 * gender is not set here (circle plans keep the original mixed audience).
 */
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { supabase } from '../../../lib/supabase';
import { requestPlanNotificationPrompt } from '../../../lib/planNotificationPrompt';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../../constants/PhotoUpload';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Check, ImagePlus, Minus, Plus, X } from 'lucide-react-native';
import { hapticSelection } from '../../../lib/haptics';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_PLAN } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { useObservedUser } from '../../../hooks/useObservedUser';
import BottomSheet from '../../yours/primitives/BottomSheet';
import { type CalendarDay } from '../../calendar/WashedUpCalendar';
import CollapsibleCalendar from '../../composer/CollapsibleCalendar';
import TimePicker from '../../composer/TimePicker';
import InlineNudge from '../../composer/InlineNudge';
import { useNudgeArbiter, NUDGE_PLACE_BASE, NUDGE_PLACE_WARM } from '../../composer/nudgeArbiter';
import { getTodayInLA, laWallTimeToUTC } from '../../../lib/laDate';
import {
  useCreateCirclePlan,
  CreateCirclePlanResult,
  type CirclePlanOperationScope,
  isUnconfirmedCirclePlanCreation,
  isObsoleteCirclePlanOperation,
} from '../../../hooks/useCreateCirclePlan';
import EditorialTitleField from '../../composer/EditorialTitleField';
import CategoryChips from '../../composer/CategoryChips';
import PlacePicker, { type PlaceValue } from '../../composer/place/PlacePicker';
import { type PlanCategory } from '../../../constants/Categories';

interface ComposerMember {
  user_id: string;
  handle?: string | null;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

type ComposerAppearance = { fonts: AfterglowFontFamilies };

interface CirclePlanComposerProps {
  appearance?: ComposerAppearance;
  /** Optional parent admission scope; null means this entry is unavailable. */
  scope?: CirclePlanOperationScope | null;
  visible: boolean;
  onClose: () => void;
  circleId: string;
  /** Resolved display name (member names for an unnamed circle / DM). */
  circleName: string;
  members: ComposerMember[];
  /** A DM is a 2-person circle: hide the "pick people" subset path. */
  isDm: boolean;
  onPosted: (result: CreateCirclePlanResult) => void;
  onCheckPlans?: () => void;
}

const MESSAGE_MIN = 10;
const MESSAGE_LIMIT = 150;
type PreparedPlanPhoto = { uri: string; base64: string; path: string };

const STRANGER_MIN = 2;
const STRANGER_MAX = 7;
// Saved create_circle_plan clamps an open two-person circle to six outsiders.
const DM_STRANGER_MAX = 6;
const STRANGER_DEFAULT = 4;

function todayCalendarDay(): CalendarDay {
  const t = getTodayInLA();
  return { year: t.y, month: t.m, day: t.d };
}

/** One row in the "pick people" multiselect: avatar, name, a terracotta check. */
function PickMemberRow({
  member,
  selected,
  onToggle,
  appearance,
}: {
  appearance?: ComposerAppearance;
  member: ComposerMember;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = member.first_name_display?.trim() || member.handle?.trim() || 'Someone';
  const handleValue = member.handle?.trim().replace(/^@+/, '');
  const handle = handleValue ? `@${handleValue}` : null;
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onToggle}
      style={styles.memberRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={handle ? `${name}, ${handle}` : name}
    >
      {appearance ? (
        <MemberPhoto key={`${member.user_id}:${member.profile_photo_url ?? ''}`}
          uri={member.profile_photo_url} name={name} appearance={appearance} />
      ) : member.profile_photo_url ? (
        <Image source={{ uri: member.profile_photo_url }} style={styles.memberAvatar} />
      ) : (
        <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
          <Text style={styles.memberInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styles.memberIdentity}>
        <Text style={styles.memberName} numberOfLines={appearance ? undefined : 1}>{name}</Text>
        {handle ? <Text style={styles.memberHandle} numberOfLines={1}>{handle}</Text> : null}
      </View>
      <View style={[styles.memberCheck, selected && styles.memberCheckOn]}>
        {selected ? <Check size={12} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function MemberPhoto({ uri, name, appearance }: { uri: string | null; name: string; appearance: ComposerAppearance }) {
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  return uri && !failed ? <Image source={{ uri }} style={styles.memberAvatar} contentFit="cover"
    onError={() => { if (mounted.current) setFailed(true); }} /> :
    <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
      <Text style={styles.memberInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
    </View>;
}

function AudienceCard({ appearance, selected, label, subtitle, onSelect, children }: {
  appearance?: ComposerAppearance; selected: boolean; label: string; subtitle: string;
  onSelect: () => void; children?: React.ReactNode;
}) {
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  const heading = <View style={styles.audTop}>
    <View style={styles.audTextWrap}>
      <Text style={styles.audName}>{label}</Text>
      <Text style={styles.audSub}>{subtitle}</Text>
    </View>
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected ? <Animated.View entering={ZoomIn.springify().mass(0.5).damping(24).stiffness(500)} style={styles.radioDot} /> : null}
    </View>
  </View>;
  // Keep the legacy surface. In the staged form, child controls are siblings
  // of the audience selector, so a checkbox or stepper is not inside a button.
  return appearance ? <View style={[styles.audCard, selected && styles.audCardOn]}>
    <TouchableOpacity activeOpacity={0.85} onPress={onSelect} accessibilityRole="radio"
      accessibilityState={{ checked: selected }} accessibilityLabel={label}
      accessibilityHint={subtitle} style={{ minHeight: 44, justifyContent: 'center' }}>
      {heading}
    </TouchableOpacity>
    {children}
  </View> : <TouchableOpacity activeOpacity={0.85} onPress={onSelect}
    style={[styles.audCard, selected && styles.audCardOn]}>{heading}{children}</TouchableOpacity>;
}

export default function CirclePlanComposer(props: CirclePlanComposerProps) {
  const viewer = useObservedUser();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const visitRef = useRef<{ circleId: string; userId: string | null | undefined; epoch: number;
    parent: CirclePlanComposerProps['scope']; isDm: boolean; serial: number; visible: boolean; closed: boolean } | null>(null);
  const visit = useMemo(() => {
    const previous = visitRef.current;
    if (previous && previous.circleId === props.circleId && previous.userId === viewer.viewerId &&
        previous.epoch === viewer.epoch && previous.parent === props.scope && previous.isDm === props.isDm &&
        !(props.visible && !previous.visible)) return previous;
    return { circleId: props.circleId, userId: viewer.viewerId, epoch: viewer.epoch,
      parent: props.scope, isDm: props.isDm, serial: (previous?.serial ?? 0) + 1,
      visible: props.visible, closed: false };
  }, [props.circleId, viewer.viewerId, viewer.epoch, props.scope, props.isDm, props.visible]);
  useLayoutEffect(() => {
    // Only a committed visit can retire the form currently on screen.
    visit.visible = props.visible;
    visitRef.current = visit;
  }, [visit, props.visible]);
  const lifetime = useMemo(() => {
    // Own successful close may hide this visit before onPosted runs. A later
    // reopen, account change, circle change or revoked parent still retires it.
    const contextCurrent = () => mounted.current && visitRef.current === visit && viewer.isCurrent() &&
      visit.parent !== null && (visit.parent === undefined ||
        (visit.parent.userId === visit.userId && visit.parent.isCurrent()));
    const scope = visit.userId ? { userId: visit.userId,
      isCurrent: () => contextCurrent() && visit.visible && !visit.closed } : null;
    const dismissCurrent = () => mounted.current && visitRef.current === visit && viewer.isCurrent() && visit.visible && !visit.closed;
    return { scope, contextCurrent, dismissCurrent, retire: () => { visit.closed = true; } };
  }, [visit, viewer.isCurrent]);
  // Render availability must not depend on the layout effect publishing this
  // visit. Imperative actions still require the committed lifetime below.
  const entryAvailable = !!viewer.viewerId && viewer.isCurrent() && props.visible && !visit.closed &&
    props.scope !== null && (props.scope === undefined ||
      (props.scope.userId === viewer.viewerId && props.scope.isCurrent()));
  return <CirclePlanComposerVisit key={visit.serial} {...props} myUserId={viewer.viewerId}
    entryAvailable={entryAvailable} entryScope={lifetime.scope} contextCurrent={lifetime.contextCurrent} dismissCurrent={lifetime.dismissCurrent} retire={lifetime.retire} />;
}

function CirclePlanComposerVisit({ visible, onClose, circleId, circleName, members, isDm, onPosted,
  myUserId, entryAvailable, entryScope, contextCurrent, dismissCurrent, retire, appearance, onCheckPlans,
}: CirclePlanComposerProps & { entryAvailable: boolean; myUserId: string | null | undefined; entryScope: CirclePlanOperationScope | null;
  contextCurrent: () => boolean; dismissCurrent: () => boolean; retire: () => void }) {
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  const strangerMax = isDm ? DM_STRANGER_MAX : STRANGER_MAX;
  const createPlan = useCreateCirclePlan();
  const queryClient = useQueryClient();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const unconfirmedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef<object | null>(null);
  const revision = useRef(0);
  const edit = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: NoInfer<React.SetStateAction<T>>) => {
    if (!entryScope?.isCurrent()) return;
    revision.current++;
    setter(value);
  };

  const [title, setTitle] = useState('');
  const [creatorMessage, setCreatorMessage] = useState('');
  const [messageValidation, setMessageValidation] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const messageInputRef = useRef<TextInput>(null);
  const messageSectionY = useRef(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoAttempt = useRef<object | null>(null);
  const preparedPhoto = useRef<PreparedPlanPhoto | null>(null);
  const messageError = creatorMessage.trim().length < MESSAGE_MIN
    ? `Add a message with at least ${MESSAGE_MIN} characters.`
    : creatorMessage.trim().length > MESSAGE_LIMIT ? `Keep your message to ${MESSAGE_LIMIT} characters.` : null;
  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [where, setWhere] = useState('');
  // Required only when the plan is opened to others (strangers lack the circle's
  // built-in context); circle-only plans stay title-first.
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<CalendarDay>(todayCalendarDay);
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState<'AM' | 'PM'>('PM');
  const [visibilityOpen, setVisibilityOpen] = useState(false); // false = circle only
  const [strangerCap, setStrangerCap] = useState(STRANGER_DEFAULT);
  // "Who exactly" (Just-us only, hidden for a DM): the whole circle, or a
  // picked subset. This is the chat-spawn signal, never surfaced as a "make a
  // chat?" question of its own (see file header + spec section 4).
  const [pickMode, setPickMode] = useState<'everyone' | 'subset'>('everyone');
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // Non-destructive feedback, gold never red (moments Tier 3/4). `hint` is a
  // warm validation line shown on a blocked post attempt; `recoveryActive` is
  // the Tier-4 soft recovery after a post failed (mirrors PlanComposerV2).
  const [hint, setHint] = useState<string | null>(null);
  const [recoveryActive, setRecoveryActive] = useState(false);

  const draft = useRef({ title, creatorMessage, imageUrl, category, where, description, date, hour, minute, period, visibilityOpen, strangerCap, pickMode, pickedIds });
  draft.current = { title, creatorMessage, imageUrl, category, where, description, date, hour, minute, period, visibilityOpen, strangerCap, pickMode, pickedIds };

  const reset = () => {
    revision.current++;
    setSaving(false);
    setTitle('');
    setCreatorMessage('');
    setMessageValidation(false);
    photoAttempt.current = null;
    preparedPhoto.current = null;
    setImageLoading(false);
    setImageUrl(null);
    setPhotoPreview(null);
    setPhotoError(null);
    setCategory(null);
    setWhere('');
    setDescription('');
    setDate(todayCalendarDay());
    setHour(7);
    setMinute('00');
    setPeriod('PM');
    setVisibilityOpen(false);
    setStrangerCap(STRANGER_DEFAULT);
    setPickMode('everyone');
    setPickedIds(new Set());
    setHint(null);
    setRecoveryActive(false);
  };

  const close = () => {
    if (!dismissCurrent()) return;
    retire();
    reset();
    onClose();
  };

  const addPhoto = async (retryPrepared = false) => {
    if (!entryScope?.isCurrent() || !myUserId || pending.current || photoAttempt.current || unconfirmedRef.current) return;
    const attempt = {}, userId = myUserId;
    photoAttempt.current = attempt;
    setImageLoading(true);
    setPhotoError(null);
    const isCurrent = () => entryScope.isCurrent() && photoAttempt.current === attempt;
    let stage: 'choose' | 'prepare' | 'upload' = retryPrepared ? 'upload' : 'choose';
    try {
      let photo = retryPrepared ? preparedPhoto.current : null;
      if (!photo) {
        // The system picker grants access to the selected image; broad library access is unnecessary.
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1 });
        if (!isCurrent() || result.canceled || !result.assets?.[0]) return;
        stage = 'prepare';
        const prepared = await ImageManipulator.manipulateAsync(result.assets[0].uri,
          [{ resize: { width: 1200 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        if (!isCurrent()) return;
        if (!prepared.base64) throw new Error('Missing prepared image');
        photo = { uri: prepared.uri, base64: prepared.base64,
          path: `${userId}/${Date.now()}-circle-${Math.random().toString(36).slice(2, 10)}.jpg` };
        preparedPhoto.current = photo;
        setPhotoPreview(photo.uri);
      }
      stage = 'upload';
      const identity = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (identity.error || identity.data.user?.id !== userId) throw new Error('Could not confirm photo owner');
      const refreshed = await requestWithDeadline(supabase.auth.refreshSession(), 12_000);
      if (!isCurrent()) return;
      if (refreshed.error) throw refreshed.error;
      const refreshedIdentity = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!isCurrent()) return;
      if (refreshedIdentity.error || refreshedIdentity.data.user?.id !== userId) throw new Error('Could not confirm photo owner');
      // Retry the same owned object path after a lost upload response. Never
      // overwrite another object or dispatch a follow-up events update.
      const remoteUrl = await requestWithDeadline(uploadBase64ToStorage('event-images', photo.path, photo.base64, { existingIsSuccess: true }), 30_000);
      if (!isCurrent()) return;
      if (!/^https?:\/\/[^\s/]+(?:\/|$)/i.test(remoteUrl)) throw new Error('Photo upload returned no remote URL');
      draft.current.imageUrl = remoteUrl;
      edit(setImageUrl, remoteUrl);
      setPhotoPreview(remoteUrl);
      preparedPhoto.current = null;
    } catch {
      if (!isCurrent()) return;
      setPhotoError(stage === 'upload' ? 'Could not upload your photo. Try again or remove it.'
        : stage === 'prepare' ? PHOTO_FORMAT_ERROR_MESSAGE : 'Couldn’t open photos. Try again.');
    } finally {
      if (photoAttempt.current === attempt) {
        photoAttempt.current = null;
        if (entryScope.isCurrent()) setImageLoading(false);
      }
    }
  };

  const removePhoto = () => {
    if (!entryScope?.isCurrent() || pending.current || unconfirmedRef.current) return;
    // Retire even an in-flight upload before another photo can be selected.
    photoAttempt.current = null;
    preparedPhoto.current = null;
    setImageLoading(false);
    setPhotoError(null);
    setPhotoPreview(null);
    draft.current.imageUrl = null;
    edit(setImageUrl, null);
  };

  // Circle members other than the poster themselves -- the pickable list. A
  // circle chat (isDm false) is always 3+ real members by definition, so this
  // is never empty when the "pick people" chip is even reachable.
  const otherMembers = useMemo(
    () => members.filter((m) => m.user_id !== myUserId),
    [members, myUserId],
  );
  // True only when the subset path is both reachable (real circle, Just us)
  // and actually chosen. Open it up and a DM never reach "subset".
  const pickingSubset = !isDm && !visibilityOpen && pickMode === 'subset';
  const subsetEmpty = pickingSubset && pickedIds.size === 0;

  const togglePicked = (id: string) => {
    if (!entryScope?.isCurrent()) return;
    hapticSelection();
    edit(setPickedIds, (prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectQuick = (k: 'tonight' | 'tomorrow') => {
    if (!entryScope?.isCurrent()) return;
    hapticSelection();
    const t = getTodayInLA();
    const base = new Date(t.y, t.m, t.d);
    if (k === 'tomorrow') base.setDate(base.getDate() + 1);
    edit(setDate, { year: base.getFullYear(), month: base.getMonth(), day: base.getDate() });
  };

  const activeQuick: 'tonight' | 'tomorrow' | null = (() => {
    const t = getTodayInLA();
    if (date.year === t.y && date.month === t.m && date.day === t.d) return 'tonight';
    const tm = new Date(t.y, t.m, t.d);
    tm.setDate(tm.getDate() + 1);
    if (date.year === tm.getFullYear() && date.month === tm.getMonth() && date.day === tm.getDate()) return 'tomorrow';
    return null;
  })();

  // Single owner of the one visible gold line. A Tier-4 recovery (a failed
  // post) suppresses the Tier-3 nudges; otherwise the arbiter picks between the
  // two Tier-3 nudges, most recently triggered wins. A validation `hint` (below)
  // shares the same gold budget: when it shows, the ambient nudges hide too.
  const nudge = useNudgeArbiter({
    recoveryActive,
    tonightEligible: activeQuick === 'tonight',
    placeSkipEligible: !where.trim(),
  });

  const onPost = async () => {
    if (!entryScope?.isCurrent() || pending.current || photoAttempt.current || preparedPhoto.current || unconfirmedRef.current) return;
    const current = draft.current;
    setHint(null);
    setRecoveryActive(false);
    if (!current.title.trim()) {
      setHint(COPY.circlePlanTitleRequired);
      return;
    }
    if (current.creatorMessage.trim().length < MESSAGE_MIN || current.creatorMessage.trim().length > MESSAGE_LIMIT) {
      const error = current.creatorMessage.trim().length < MESSAGE_MIN
        ? `Add a message with at least ${MESSAGE_MIN} characters.` : `Keep your message to ${MESSAGE_LIMIT} characters.`;
      setMessageValidation(true);
      AccessibilityInfo.announceForAccessibility(error);
      messageInputRef.current?.focus();
      scrollRef.current?.scrollTo({ y: Math.max(0, messageSectionY.current - 12), animated: true });
      return;
    }
    const subset = !isDm && !current.visibilityOpen && current.pickMode === 'subset';
    if (subset && current.pickedIds.size === 0) {
      setHint(COPY.circlePlanPickPeopleRequired);
      return;
    }
    if (current.visibilityOpen && !current.description.trim()) {
      setHint(COPY.circlePlanDescriptionRequired);
      return;
    }
    let h = current.hour % 12;
    if (current.period === 'PM') h += 12;
    const start = laWallTimeToUTC(current.date.year, current.date.month, current.date.day, h, parseInt(current.minute, 10));
    if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
      setHint(COPY.circlePlanWhenRequired);
      return;
    }
    const attempt = {};
    const submittedRevision = revision.current;
    pending.current = attempt;
    setSaving(true);
    try {
      const result = await createPlan.mutateAsync({
        scope: entryScope,
        circleId,
        title: current.title.trim(),
        creatorMessage: current.creatorMessage.trim(),
        imageUrl: current.imageUrl,
        startTime: start.toISOString(),
        visibility: current.visibilityOpen ? 'open' : 'circle_only',
        strangerCap: current.visibilityOpen ? Math.min(current.strangerCap, strangerMax) : null,
        memberUserIds: subset ? Array.from(current.pickedIds) : null,
        locationText: current.where.trim() || null,
        primaryVibe: current.category?.toLowerCase() ?? null,
        description: current.visibilityOpen ? (current.description.trim() || null) : null,
      });
      if (!entryScope.isCurrent() || pending.current !== attempt) return;
      if (revision.current !== submittedRevision) {
        setHint('Your earlier plan was posted. Your latest changes are still here.');
        return;
      }
      close();
      if (contextCurrent()) {
        requestPlanNotificationPrompt({ userId: entryScope.userId, planId: result.event_id, reason: 'posted' }, contextCurrent);
        onPosted(result);
      }
    } catch (error) {
      if (!entryScope.isCurrent() || pending.current !== attempt || isObsoleteCirclePlanOperation(error)) return;
      // A lost reply can follow a committed plan. Keep this entry's draft and
      // do not offer a second create until the person checks their circle.
      if (isUnconfirmedCirclePlanCreation(error)) {
        unconfirmedRef.current = true;
        setUnconfirmed(true);
        setRecoveryActive(false);
      } else {
        setRecoveryActive(true);
      }
    } finally {
      if (pending.current === attempt) {
        pending.current = null;
        if (entryScope.isCurrent()) setSaving(false);
      }
    }
  };

  const checkPlans = () => {
    if (!entryScope?.isCurrent()) return;
    // Refresh the existing read before returning; never infer a saved plan
    // from this action or manufacture an ID for navigation.
    void queryClient.invalidateQueries({ queryKey: ['circle-plans', circleId] }).catch(() => {});
    if (!entryScope.isCurrent()) return;
    close();
    if (contextCurrent()) onCheckPlans?.();
  };

  const postDisabled =
    unconfirmed || saving || imageLoading || !!preparedPhoto.current ||
    !entryAvailable ||
    !title.trim() ||
    (visibilityOpen && !description.trim()) ||
    subsetEmpty;

  return (
    <BottomSheet appearance={appearance} visible={visible} onClose={close} heightPct={CIRCLE_PLAN.sheetHeightPct} springMotion>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetEyebrow}>{circleName}</Text>
          <Text style={styles.sheetTitle}>{COPY.circlePlanComposerTitle}</Text>
        </View>

        {/* What */}
        <EditorialTitleField
          appearance={appearance}
          value={title}
          onChangeText={(value) => edit(setTitle, value)}
          placeholder={COPY.circlePlanWhatPlaceholder}
          label={COPY.circlePlanWhatLabel}
          maxLength={80}
        />

        <View style={styles.photoRow}>
          {photoPreview ? <View style={styles.photoThumbWrap}>
            <Image source={{ uri: photoPreview }} style={styles.photoThumb} contentFit="cover" accessibilityLabel="Plan photo" />
            {imageLoading ? <View style={styles.photoOverlay}><ActivityIndicator color={Colors.white} /></View> : null}
            <TouchableOpacity style={styles.photoRemove} accessibilityRole="button" accessibilityLabel="Remove photo"
              disabled={saving || unconfirmed} accessibilityState={{ disabled: saving || unconfirmed }} onPress={removePhoto}>
              <X size={18} color={Colors.white} />
            </TouchableOpacity>
          </View> : <TouchableOpacity style={styles.photoAdd} accessibilityRole="button"
            accessibilityLabel={imageLoading ? 'Adding photo' : 'Add photo'}
            disabled={imageLoading || saving || unconfirmed} accessibilityState={{ disabled: imageLoading || saving || unconfirmed, busy: imageLoading }}
            onPress={() => void addPhoto()}>
            <ImagePlus size={18} color={appearance ? AfterglowColors.muted : Colors.secondary} />
            <Text style={styles.photoAddText}>{imageLoading ? 'Adding photo…' : 'Add photo'}</Text>
          </TouchableOpacity>}
          {photoError ? <View style={styles.photoFeedback}>
            <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite">{photoError}</Text>
            <TouchableOpacity style={styles.photoRetry} accessibilityRole="button" accessibilityLabel="Retry photo"
              disabled={imageLoading || saving || unconfirmed} onPress={() => void addPhoto(!!preparedPhoto.current)}>
              <Text style={styles.photoRetryText}>Try again</Text>
            </TouchableOpacity>
          </View> : null}
        </View>

        {/* Category */}
        <View style={styles.categoryWrap}>
          <CategoryChips appearance={appearance} selected={category} onSelect={(value) => edit(setCategory, value)} />
        </View>

        <View style={styles.messageWrap} onLayout={event => { messageSectionY.current = event.nativeEvent.layout.y; }}>
          <Text style={styles.fieldLabel}>Your message · required</Text>
          <TextInput ref={messageInputRef} accessibilityLabel="Your message"
            accessibilityHint={messageValidation ? messageError ?? undefined : undefined}
            style={[styles.descInput, messageValidation && messageError ? styles.invalidInput : undefined]}
            value={creatorMessage} onChangeText={value => edit(setCreatorMessage, value)}
            placeholder="Come along for a sunset walk and a catch-up…"
            placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
            multiline maxLength={MESSAGE_LIMIT} />
          {messageValidation && messageError ? <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite">{messageError}</Text> : null}
        </View>

        {/* Where */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhereLabel}</Text>
        <View style={styles.whereWrap}>
          <PlacePicker
            appearance={appearance}
            value={where.trim() ? { name: where.trim(), lat: null, lng: null, neighborhood: null } : null}
            onChange={(v: PlaceValue | null) => edit(setWhere, v?.name ?? '')}
          />
          {nudge === 'placeSkip' && !hint ? (
            <InlineNudge appearance={appearance} text={appearance ? 'A meeting place helps everyone find you. You can add it later.' : visibilityOpen ? NUDGE_PLACE_WARM : NUDGE_PLACE_BASE} />
          ) : null}
        </View>

        {/* When */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhenLabel}</Text>
        <View style={styles.quickRow}>
          {(['tonight', 'tomorrow'] as const).map((k) => {
            const on = activeQuick === k;
            return (
              <TouchableOpacity
                key={k}
                activeOpacity={0.7}
                onPress={() => selectQuick(k)}
                style={[styles.quickChip, on && styles.quickChipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>{appearance ? (k === 'tonight' ? 'Tonight' : 'Tomorrow') : k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.calendarWrap}>
          <CollapsibleCalendar appearance={appearance} selected={date} onSelect={(value) => edit(setDate, value)} />
        </View>
        <View style={styles.timeWrap}>
          <TimePicker
            appearance={appearance}
            hour={hour}
            minute={minute}
            period={period}
            selected
            onChange={(h, m, p) => { edit(setHour, h); edit(setMinute, m); edit(setPeriod, p); }}
          />
          {nudge === 'tonight' && !hint ? <InlineNudge appearance={appearance} text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHO IS THIS FOR - the audience choice. Just us reveals a second,
            secondary choice (progressive disclosure): the whole circle, or a
            picked subset that quietly gets its own chat. See spec section 4. */}
        <Text style={styles.sectionLabel}>{appearance ? 'Who is this for?' : COPY.circlePlanWhoLabel}</Text>

        {/* Just us */}
        <AudienceCard appearance={appearance} selected={!visibilityOpen}
          label={COPY.circlePlanJustUs} subtitle={COPY.circlePlanJustUsSub(circleName)}
          onSelect={() => { if (!entryScope?.isCurrent()) return; hapticSelection(); edit(setVisibilityOpen, false); }}>

          {/* Who exactly (the chat-spawn signal). A DM is already exactly the
              2 people in it, so there is no one else to pick -- hidden. */}
          {!visibilityOpen && !isDm ? (
            <Animated.View
              entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
              style={styles.recipientBlock}
            >
              <View style={styles.chipRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { if (!entryScope?.isCurrent()) return; hapticSelection(); edit(setPickMode, 'everyone'); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: pickMode === 'everyone' }}
                  accessibilityLabel={COPY.circlePlanEveryone(circleName)}
                  style={[styles.recipientChip, pickMode === 'everyone' && styles.recipientChipOn]}
                >
                  <Text
                    style={[styles.recipientChipText, pickMode === 'everyone' && styles.recipientChipTextOn]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {appearance ? 'Everyone' : COPY.circlePlanEveryone(circleName)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { if (!entryScope?.isCurrent()) return; hapticSelection(); edit(setPickMode, 'subset'); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: pickMode === 'subset' }}
                  style={[styles.recipientChipGhost, pickMode === 'subset' && styles.recipientChipOn]}
                >
                  <Text style={[styles.recipientChipGhostText, pickMode === 'subset' && styles.recipientChipTextOn]}>
                    {COPY.circlePlanPickPeople}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helper}>{COPY.circlePlanPickHelper}</Text>

              {pickMode === 'subset' ? (
                <View style={styles.memberList}>
                  {otherMembers.map((m) => (
                    <PickMemberRow
                      key={m.user_id}
                      member={m}
                      appearance={appearance}
                      selected={pickedIds.has(m.user_id)}
                      onToggle={() => togglePicked(m.user_id)}
                    />
                  ))}
                </View>
              ) : null}
              {subsetEmpty ? <InlineNudge appearance={appearance} text={COPY.circlePlanPickPeopleRequired} /> : null}
            </Animated.View>
          ) : null}
        </AudienceCard>

        {/* Open it up (+ stranger stepper reveal + capacity truth) */}
        <AudienceCard appearance={appearance} selected={visibilityOpen}
          label={COPY.circlePlanOpenUp} subtitle={COPY.circlePlanOpenUpSub}
          onSelect={() => { if (!entryScope?.isCurrent()) return; hapticSelection(); edit(setVisibilityOpen, true); }}>

          {visibilityOpen ? (
            <Animated.View
              entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
              style={styles.stepperReveal}
            >
              <Text style={styles.stepperRevealLabel}>{COPY.circlePlanStepperLabel}</Text>
              <View style={styles.stepperInline}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => edit(setStrangerCap, (c) => Math.max(STRANGER_MIN, c - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Fewer people"
                  accessibilityState={{ disabled: strangerCap <= STRANGER_MIN }}
                  disabled={strangerCap <= STRANGER_MIN}
                  style={[styles.stepperBtn, strangerCap <= STRANGER_MIN && styles.stepperBtnOff]}
                >
                  <Minus size={16} color={strangerCap <= STRANGER_MIN ? (appearance ? AfterglowColors.muted : Colors.tertiary) : (appearance ? AfterglowColors.clay : Colors.terracotta)} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.stepperValue} accessibilityLiveRegion="polite">{strangerCap}</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => edit(setStrangerCap, (c) => Math.min(strangerMax, c + 1))}
                  accessibilityRole="button"
                  accessibilityLabel="More people"
                  accessibilityState={{ disabled: strangerCap >= strangerMax }}
                  disabled={strangerCap >= strangerMax}
                  style={[styles.stepperBtn, strangerCap >= strangerMax && styles.stepperBtnOff]}
                >
                  <Plus size={16} color={strangerCap >= strangerMax ? (appearance ? AfterglowColors.muted : Colors.tertiary) : (appearance ? AfterglowColors.clay : Colors.terracotta)} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.stepperRange}>{isDm ? '2 to 6' : COPY.circlePlanStrangerRange}</Text>
              </View>
              <View style={styles.capacityTruthPill}>
                <Text style={styles.capacityTruthText}>
                  {COPY.circlePlanCapacityTruth(members.length, strangerCap)}
                </Text>
              </View>
            </Animated.View>
          ) : null}
        </AudienceCard>

        {/* DESCRIPTION (required once opened to others; strangers lack the
            circle's built-in context). Hidden for circle-only plans. */}
        {visibilityOpen ? (
          <Animated.View
            entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
            style={styles.descWrap}
          >
            <Text style={styles.fieldLabel}>{appearance ? 'Description (required)' : COPY.circlePlanDescriptionLabel}</Text>
            <TextInput
              accessibilityLabel={COPY.circlePlanDescriptionLabel}
              style={styles.descInput}
              value={description}
              onChangeText={(value) => edit(setDescription, value)}
              placeholder={COPY.circlePlanDescriptionPlaceholder}
              placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
              multiline
              maxLength={2000}
            />
            {!description.trim() ? (
              <InlineNudge appearance={appearance} text={appearance ? 'Let people know what to expect before they join.' : COPY.circlePlanDescriptionRequired} />
            ) : null}
          </Animated.View>
        ) : null}

        {/* One gold line, never red. Tier-4 recovery (failed post, tap to
            dismiss) wins; otherwise a Tier-3 validation hint. */}
        {!unconfirmed && nudge === 'recovery' ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${COPY.circlePlanRecovery} Dismiss notice`}
            style={styles.recoveryNudge}
            onPress={() => { if (entryScope?.isCurrent()) setRecoveryActive(false); }}
            activeOpacity={0.8}
          >
            <View style={styles.recoveryDot} />
            <Text style={styles.recoveryText}>{COPY.circlePlanRecovery}</Text>
          </TouchableOpacity>
        ) : !unconfirmed && hint ? (
          <InlineNudge appearance={appearance} text={hint} />
        ) : null}

        {unconfirmed ? <View style={styles.uncertainPanel} accessibilityLiveRegion="polite">
          <Text style={styles.uncertainTitle}>Check before posting again</Text>
          <Text style={styles.uncertainText}>We didn’t receive confirmation. Your plan may already be saved. Check the circle before posting again.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={onCheckPlans ? 'View circle' : 'Close'}
            onPress={checkPlans} style={styles.postBtn}>
            <Text style={styles.postBtnText}>{onCheckPlans ? 'View circle' : 'Close'}</Text>
          </TouchableOpacity>
        </View> : <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPost}
          accessibilityRole="button"
          accessibilityState={{ disabled: postDisabled, busy: saving || imageLoading }}
          disabled={postDisabled}
          style={[styles.postBtn, postDisabled && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>
            {appearance ? (saving ? 'Posting…' : 'Post plan') : (visibilityOpen ? COPY.circlePlanPostToFeed : COPY.circlePlanPostToCircle(circleName))}
          </Text>
        </TouchableOpacity>}
      </ScrollView>
    </BottomSheet>
  );
}

const legacyStyles = StyleSheet.create({
  photoRow: { marginTop: 12, marginBottom: CIRCLE_PLAN.sectionGap, alignItems: 'flex-start' },
  photoAdd: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  photoAddText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  photoThumbWrap: { width: 128, height: 80, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.inputBg },
  photoThumb: { width: '100%', height: '100%' },
  photoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayWarm },
  photoRemove: { position: 'absolute', right: 0, top: 0, width: 44, height: 44, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.darkWarm },
  photoFeedback: { marginTop: 8, alignSelf: 'stretch', gap: 4 },
  photoRetry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  photoRetryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  messageWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  fieldError: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand, marginTop: 6 },
  invalidInput: { borderColor: Colors.errorBrand },
  uncertainPanel: { gap: 12, paddingTop: 16 },
  uncertainTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  uncertainText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: CIRCLE_PLAN.sectionGap },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.darkWarm,
    marginBottom: CIRCLE_PLAN.sectionGap,
  },
  fieldLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.terracotta,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: CIRCLE_PLAN.labelGap,
  },
  field: {
    minHeight: CIRCLE_PLAN.fieldMinHeight,
    borderRadius: CIRCLE_PLAN.fieldRadius,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: CIRCLE_PLAN.fieldPadH,
    paddingVertical: CIRCLE_PLAN.fieldPadV,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: CIRCLE_PLAN.sectionGap,
  },
  categoryWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  whereWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  descWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  descInput: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 72,
    textAlignVertical: 'top',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
  calendarWrap: {},
  timeWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  quickRow: { flexDirection: 'row', gap: 7, marginBottom: CIRCLE_PLAN.labelGap },
  quickChip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  quickChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  quickChipText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary },
  quickChipTextOn: { color: Colors.white },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CIRCLE_PLAN.chipGap,
    marginBottom: CIRCLE_PLAN.chipGap,
  },
  timeChipsContent: { gap: CIRCLE_PLAN.chipGap, paddingRight: CIRCLE_PLAN.fieldPadH },
  timeChip: {
    minWidth: CIRCLE_PLAN.timeChipMinWidth,
    paddingHorizontal: CIRCLE_PLAN.dayChipPadH,
    paddingVertical: CIRCLE_PLAN.dayChipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
  },
  timeChipOn: { backgroundColor: Colors.terracotta },
  timeChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  timeChipTextOn: { color: Colors.white, fontFamily: Fonts.sansBold },
  periodGroup: { flexDirection: 'row', gap: CIRCLE_PLAN.chipGap, marginLeft: 'auto' },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.terracotta,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginTop: CIRCLE_PLAN.chipGap,
    marginBottom: CIRCLE_PLAN.labelGap,
  },
  audienceCard: {
    borderRadius: CIRCLE_PLAN.cardRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingVertical: CIRCLE_PLAN.cardPadV,
    paddingHorizontal: CIRCLE_PLAN.cardPadH,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  audienceCardOn: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  audienceTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: 2,
  },
  audienceSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.overlayWarm,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  chipRow: { flexDirection: 'row', gap: CIRCLE_PLAN.chipGap, marginBottom: CIRCLE_PLAN.labelGap },
  recipientChip: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    backgroundColor: Colors.inputBg,
    // "Everyone in {circle}" carries a variable-length name (an unnamed
    // circle falls back to a member-list title); shrink + ellipsize rather
    // than overflow the row or squeeze the "Pick people" chip beside it.
    flexShrink: 1,
    minWidth: 0,
  },
  recipientChipGhost: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  recipientChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  recipientChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientChipGhostText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientChipTextOn: { color: Colors.white, fontFamily: Fonts.sansBold },
  helper: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary, lineHeight: 18 },
  memberList: { marginTop: CIRCLE_PLAN.labelGap, gap: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: CIRCLE_PLAN.memberRowGap, paddingVertical: 6 },
  memberAvatar: { width: CIRCLE_PLAN.memberAvatar, height: CIRCLE_PLAN.memberAvatar, borderRadius: CIRCLE_PLAN.memberAvatar / 2, backgroundColor: Colors.inputBg },
  memberAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accentSubtle },
  memberInitial: { fontFamily: Fonts.displayBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
  memberIdentity: { flex: 1, minWidth: 0, gap: 3 },
  memberHandle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  memberName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  memberCheck: {
    width: CIRCLE_PLAN.memberCheck,
    height: CIRCLE_PLAN.memberCheck,
    borderRadius: CIRCLE_PLAN.memberCheck / 2,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCheckOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  stepperBlock: { marginBottom: CIRCLE_PLAN.cardGap },
  stepperLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: CIRCLE_PLAN.labelGap },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: CIRCLE_PLAN.stepperGap, marginBottom: CIRCLE_PLAN.labelGap },
  stepperBtn: {
    width: CIRCLE_PLAN.stepperBtn,
    height: CIRCLE_PLAN.stepperBtn,
    borderRadius: CIRCLE_PLAN.stepperRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnOff: { borderColor: Colors.border },
  stepperValue: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.darkWarm, minWidth: 28, textAlign: 'center' },
  // Tier-4 soft recovery line, gold never red (mirrors PlanComposerV2).
  recoveryNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: CIRCLE_PLAN.labelGap,
  },
  recoveryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  recoveryText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, lineHeight: 18, color: Colors.quoteText },
  postBtn: {
    height: CIRCLE_PLAN.postHeight,
    borderRadius: CIRCLE_PLAN.postRadius,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: CIRCLE_PLAN.chipGap,
  },
  postBtnDisabled: { opacity: 0.5 },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },

  // Sheet header (eyebrow = circle name)
  sheetHeader: { marginBottom: CIRCLE_PLAN.sectionGap },
  sheetEyebrow: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.3,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 2,
  },
  sheetTitle: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.darkWarm },

  // Audience binary cards
  audCard: {
    borderRadius: CIRCLE_PLAN.cardRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingVertical: CIRCLE_PLAN.cardPadV,
    paddingHorizontal: CIRCLE_PLAN.cardPadH,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  audCardOn: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  audTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  audTextWrap: { flex: 1, paddingRight: 12 },
  audName: { fontFamily: Fonts.displayBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, marginBottom: 3 },
  audSub: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Colors.secondary },
  radio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 1.5, borderColor: Colors.borderWarm,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: Colors.terracotta },
  radioDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: Colors.terracotta },

  // Stranger stepper reveal
  stepperReveal: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: Colors.overlayWarm,
  },
  stepperRevealLabel: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary, marginBottom: 10 },
  stepperInline: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperRange: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.tertiary, marginLeft: 4 },

  // Capacity truth (gold-tinted pill + readable warm text)
  capacityTruthPill: {
    marginTop: 12, alignSelf: 'flex-start',
    backgroundColor: Colors.goldBadgeSoft, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  capacityTruthText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.quoteText },
});

function composerStyles(appearance?: ComposerAppearance) {
  if (!appearance) return legacyStyles;
  const { fonts } = appearance;
  return { ...legacyStyles, ...StyleSheet.create({
    scroll: { flex: 1, minHeight: 0 },
    scrollContent: { paddingBottom: 24 },
    sheetHeader: { marginBottom: 24 },
    sheetEyebrow: { ...AfterglowType.caption, fontFamily: fonts.medium, color: AfterglowColors.muted, marginBottom: 5 },
    sheetTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    fieldLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 8 },
    sectionLabel: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginTop: 4, marginBottom: 12 },
    categoryWrap: { marginBottom: 24 },
    whereWrap: { marginBottom: 24 },
    timeWrap: { marginBottom: 24 },
    quickRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    photoAdd: { ...legacyStyles.photoAdd, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    photoAddText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    photoRetryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    fieldError: { ...AfterglowType.caption, fontFamily: fonts.medium, color: Colors.errorBrand, marginTop: 6 },
    quickChip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6,
      justifyContent: 'center', borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    quickChipOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    quickChipText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    quickChipTextOn: { color: AfterglowColors.white },
    audCard: { borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line,
      backgroundColor: AfterglowColors.white, padding: 14, marginBottom: 12 },
    audCardOn: { borderColor: AfterglowColors.clay, backgroundColor: AfterglowColors.white },
    audName: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 3 },
    audSub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    radio: { width: 22, height: 22, borderRadius: 11, marginTop: 2, borderWidth: 1.5,
      borderColor: AfterglowColors.line, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: AfterglowColors.clay },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: AfterglowColors.clay },
    recipientBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: AfterglowColors.subtleLine },
    chipRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    recipientChip: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10,
      borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line, justifyContent: 'center', alignItems: 'center' },
    recipientChipGhost: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10,
      borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line, justifyContent: 'center', alignItems: 'center' },
    recipientChipOn: { backgroundColor: AfterglowColors.ink, borderColor: AfterglowColors.ink },
    recipientChipText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    recipientChipGhostText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    recipientChipTextOn: { color: AfterglowColors.white, fontFamily: fonts.semibold },
    helper: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    memberList: { marginTop: 12, gap: 2 },
    memberRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: AfterglowColors.avatar },
    memberAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: AfterglowColors.avatar },
    memberInitial: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    uncertainTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    uncertainText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    memberHandle: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    memberName: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    memberCheck: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line,
      alignItems: 'center', justifyContent: 'center' },
    memberCheckOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    stepperReveal: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: AfterglowColors.subtleLine },
    stepperRevealLabel: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink, marginBottom: 10 },
    stepperInline: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepperBtn: { width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.clay,
      alignItems: 'center', justifyContent: 'center' },
    stepperBtnOff: { borderColor: AfterglowColors.line },
    stepperValue: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.ink, minWidth: 28, textAlign: 'center' },
    stepperRange: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, flexShrink: 1 },
    capacityTruthPill: { marginTop: 12, borderTopWidth: 1, borderTopColor: AfterglowColors.subtleLine, paddingTop: 12 },
    capacityTruthText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    descWrap: { marginTop: 12, marginBottom: 20 },
    descInput: { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink,
      backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 6,
      paddingHorizontal: 12, paddingVertical: 12, minHeight: 112, textAlignVertical: 'top' },
    recoveryNudge: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
      backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.line,
      borderRadius: 6, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12 },
    recoveryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AfterglowColors.clay },
    recoveryText: { flex: 1, ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    postBtn: { minHeight: 48, borderRadius: 6, backgroundColor: AfterglowColors.clay,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 12 },
    postBtnText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
  }) };
}
