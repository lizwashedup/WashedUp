/**
 * View-circle detail page.
 *
 * Reached from the circle chat header's "View circle" button. This is the
 * circle's noticeboard moved off the chat surface: identity (cover + name +
 * member count + description), "who's in it" (with an add affordance), and
 * "coming up" plans. Circle management that used
 * to live on the stacked home (leave) now lives here, in the header overflow.
 *
 * Gated behind GROUPS_ENABLED (a direct hit with the flag off bounces to Chats).
 * Note: the static `circle/new` route takes precedence over this dynamic one.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import { GROUPS_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import Colors, { AfterglowColors, SceneDetailColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../../components/yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useCircle } from '../../hooks/useCircle';
import { useLeaveCircle, isObsoleteCircleLeave } from '../../hooks/useLeaveCircle';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { circleDisplay } from '../../lib/circles/display';
import { BrandedAlert } from '../../components/BrandedAlert';
import CircleNoticeboard from '../../components/circles/CircleNoticeboard';
import ProfileButton from '../../components/ProfileButton';
import AddPeopleSheet from '../../components/circles/AddPeopleSheet';
import NameCircleSheet from '../../components/circles/NameCircleSheet';
import CirclePlanComposer from '../../components/circles/plan/CirclePlanComposer';

function CircleDetail({ circleId }: { circleId: string }) {
  const router = useRouter();
  const focused = useIsFocused();
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED, 'creator');
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  const { data, isLoading, isError, refetch, viewerId: userId, viewerEpoch, isCurrentViewer } = useCircle(circleId);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [retryPressed, setRetryPressed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const entrySerial = useRef(0);
  const entry = useMemo(() => ({ serial: ++entrySerial.current }), [circleId, userId, viewerEpoch, isError]);
  const activeEntry = useRef<typeof entry | null>(null);
  const entryReadable = useRef(false);
  entryReadable.current = !!userId && !!data && !isLoading && !isError;
  const isCurrentContext = useCallback(() => activeEntry.current === entry && isCurrentViewer(), [entry, isCurrentViewer]);
  // Payload identity changes during ordinary refetches. Read access live while
  // retaining one stable scope so refreshed metadata cannot erase open drafts.
  const isCurrentEntry = useCallback(() => isCurrentContext() && entryReadable.current, [isCurrentContext]);
  const operationScope = useMemo(() => userId ? { userId, isCurrent: isCurrentEntry } : null, [userId, isCurrentEntry]);
  const plansScope = useMemo(() => userId ? { userId, epoch: viewerEpoch, isCurrent: isCurrentEntry } : undefined, [userId, viewerEpoch, isCurrentEntry]);
  // Native navigation keeps the underlying page mounted. Retire route taps on
  // blur/return without retiring the account-owned calendar read behind it.
  const navigationVisit = useMemo(() => ({ focused, started: false }), [entry, focused]);
  const latestNavigationVisit = useRef(navigationVisit); latestNavigationVisit.current = navigationVisit;
  const canNavigate = () => isCurrentContext() && latestNavigationVisit.current === navigationVisit && navigationVisit.focused && !navigationVisit.started;
  const openRoute = (href: string, reuseTabs = false) => {
    if (!isCurrentEntry() || !canNavigate()) return;
    navigationVisit.started = true;
    try {
      // Circle details live above the tabs. Reuse that existing navigator
      // when returning to chat rather than mounting a second inbox.
      if (reuseTabs) router.dismissTo(href as never);
      else router.push(href as never);
    }
    catch (error) { navigationVisit.started = false; throw error; }
  };
  const leaveCircle = useLeaveCircle(userId, operationScope);
  const pendingLeave = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeEntry.current = entry;
    pendingLeave.current = null;
    setConfirmLeave(false); setRetryPressed(false); setAddOpen(false); setNameOpen(false); setEditOpen(false); setPlanOpen(false);
    return () => { if (activeEntry.current === entry) activeEntry.current = null; };
  }, [entry]);

  // Unnamed circles (DMs grown to a circle, name='') render by member names, not
  // blank. circleDisplay gives "Marlowe, Sage" for 3+ and the counterpart for 2.
  const display = data && userId
    ? circleDisplay(
        data.circle.name,
        data.members.map((m) => ({
          user_id: m.user_id,
          name: m.first_name_display,
          avatar_url: m.profile_photo_url,
        })),
        userId,
      )
    : null;
  const title = display?.title ?? data?.circle.name ?? '';
  const memberIds = data?.members.map((m) => m.user_id) ?? [];

  // An unnamed circle (a DM grown to 3+ people) reads as its member names until
  // someone gives it an identity. Only an admin can rename (update_circle is
  // admin-gated), and a 2-person DM is intentionally left unnamed, so the "Name
  // this circle" front door shows only to an admin of an unnamed 3+ circle.
  const myRole = data?.members.find((m) => m.user_id === userId)?.role;
  const isUnnamed = !(data?.circle.name ?? '').trim();
  const canName = !!data && isUnnamed && !display?.isDm && myRole === 'admin';
  const canNameCurrent = useRef(canName);
  canNameCurrent.current = canName;
  const isCurrentNamingEntry = useCallback(() => isCurrentEntry() && canNameCurrent.current, [isCurrentEntry]);
  const namingScope = useMemo(() => userId ? { userId, isCurrent: isCurrentNamingEntry } : null, [userId, isCurrentNamingEntry]);
  useLayoutEffect(() => { if (!canName) setNameOpen(false); }, [canName]);

  // Named circles can edit their existing identity without entering the empty
  // naming flow. The live admin check also retires a picker/save after role loss.
  const canEditCover = !!appearance && !!data && !isUnnamed && !display?.isDm && myRole === 'admin';
  const canEditCurrent = useRef(canEditCover);
  canEditCurrent.current = canEditCover;
  const isCurrentEditingEntry = useCallback(() => isCurrentEntry() && canEditCurrent.current, [isCurrentEntry]);
  const editingScope = useMemo(() => userId ? { userId, isCurrent: isCurrentEditingEntry } : null, [userId, isCurrentEditingEntry]);
  useLayoutEffect(() => { if (!canEditCover) setEditOpen(false); }, [canEditCover]);

  const doLeave = async () => {
    if (!isCurrentEntry() || pendingLeave.current) return;
    const attempt = {};
    pendingLeave.current = attempt;
    try {
      await leaveCircle.mutateAsync(circleId);
      // Both confirmed outcomes leave the entire circle stack invalid.
      if (isCurrentEntry() && pendingLeave.current === attempt) router.dismissAll();
    } catch (error) {
      if (isCurrentEntry() && pendingLeave.current === attempt && !isObsoleteCircleLeave(error)) {
        Alert.alert(COPY.circleLeaveError);
      }
    } finally {
      // An obsolete operation still releases its own guard, never a newer one.
      if (pendingLeave.current === attempt) pendingLeave.current = null;
    }
  };

  return (
    <SafeAreaView style={[styles.container, appearance && staged.container]} edges={['top']}>
      {appearance && <LinearGradient
        pointerEvents="none"
        colors={[SceneDetailColors.upper, SceneDetailColors.middle, SceneDetailColors.lower]}
        locations={[...SceneDetailColors.gradientLocations]}
        style={StyleSheet.absoluteFill}
      />}
      <View style={[styles.header, appearance && staged.header]}>
        <Pressable
          style={appearance && staged.headerButton}
          onPress={() => { if (canNavigate()) { navigationVisit.started = true; router.back(); } }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleHomeBack}
        >
          <ChevronLeft size={CIRCLE_HOME.headerIcon} color={appearance ? AfterglowColors.ink : Colors.asphalt} />
        </Pressable>
        <Text style={[styles.headerTitle, appearance && staged.headerTitle, appearance && { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink }]} numberOfLines={1}>
          {appearance ? 'Circle' : title}
        </Text>
        {data ? (
          <Pressable
            style={appearance && staged.headerButton}
            onPress={() => {
              if (!isCurrentEntry()) return;
              hapticSelection();
              setConfirmLeave(true);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={COPY.circleHomeMore}
          >
            <MoreHorizontal size={CIRCLE_HOME.headerIcon} color={appearance ? AfterglowColors.ink : Colors.asphalt} />
          </Pressable>
        ) : (
          <View style={[styles.headerSpacer, appearance && staged.headerButton]} />
        )}
        <View style={styles.profileAction}><ProfileButton compact /></View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta} accessibilityLabel="Loading circle" />
        </View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, appearance && { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted }]}>{COPY.circleLoadError}</Text>
          <Pressable
            onPress={() => { if (isCurrentContext()) void refetch(); }}
            onPressIn={() => { if (isCurrentContext()) setRetryPressed(true); }}
            onPressOut={() => { if (isCurrentContext()) setRetryPressed(false); }}
            style={[styles.retry, appearance && staged.retry, retryPressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={COPY.circlesRetry}
          >
            <Text style={[styles.retryLabel, appearance && { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay }]}>{COPY.circlesRetry}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <CircleNoticeboard
            payload={data}
            displayName={title}
            appearance={appearance}
            operationScope={operationScope ?? undefined}
            plansScope={plansScope}
            onOpenPlan={id => openRoute(`/plan/${id}`)}
            onAddPeople={() => { if (isCurrentEntry()) setAddOpen(true); }}
            onPostPlan={() => { if (isCurrentEntry()) setPlanOpen(true); }}
            onOpenChat={() => openRoute(`/(tabs)/chats/circle/${circleId}`, true)}
            onEditCover={canEditCover ? () => {
              if (!isCurrentEditingEntry()) return;
              hapticSelection();
              setEditOpen(true);
            } : undefined}
            onNameCircle={
              canName
                ? () => {
                    if (!isCurrentEntry() || !canNameCurrent.current) return;
                    hapticSelection();
                    setNameOpen(true);
                  }
                : undefined
            }
          />
        </ScrollView>
      )}

      <AddPeopleSheet
        key={`add:${entry.serial}`}
        appearance={appearance}
        scope={operationScope}
        visible={addOpen && isCurrentEntry()}
        circleId={circleId}
        existingMemberIds={memberIds}
        onClose={() => { if (isCurrentContext()) setAddOpen(false); }}
      />

      <NameCircleSheet
        key={`name:${entry.serial}`}
        scope={namingScope}
        appearance={appearance}
        visible={nameOpen && canName && isCurrentEntry()}
        circleId={circleId}
        userId={userId}
        currentCoverUploadId={data?.circle.cover_upload_id ?? null}
        onClose={() => { if (isCurrentContext()) setNameOpen(false); }}
      />

      <NameCircleSheet
        key={`edit:${entry.serial}`}
        mode="edit"
        scope={editingScope}
        appearance={appearance}
        visible={editOpen && canEditCover && isCurrentEntry()}
        circleId={circleId}
        userId={userId}
        initialName={data?.circle.name}
        initialDescription={data?.circle.description ?? null}
        currentCoverUploadId={data?.circle.cover_upload_id ?? null}
        onClose={() => { if (isCurrentContext()) setEditOpen(false); }}
      />

      <CirclePlanComposer
        key={`plan:${entry.serial}`}
        appearance={appearance}
        scope={operationScope}
        visible={planOpen && isCurrentEntry()}
        onClose={() => { if (isCurrentContext()) setPlanOpen(false); }}
        circleId={circleId}
        circleName={title}
        members={(data?.members ?? []).map((m) => ({
          user_id: m.user_id,
          first_name_display: m.first_name_display,
          handle: m.handle,
          profile_photo_url: m.profile_photo_url,
        }))}
        isDm={!!display?.isDm}
        onCheckPlans={() => { if (isCurrentEntry()) setPlanOpen(false); }}
        onPosted={(result) => {
          if (!isCurrentEntry()) return;
          if (result.has_own_chat) openRoute(`/plan/${result.event_id}`);
        }}
      />

      <BrandedAlert
        key={`leave:${entry.serial}`}
        visible={confirmLeave && isCurrentEntry()}
        title={COPY.circleLeaveTitle}
        message={COPY.circleLeaveBody}
        buttons={[
          { text: COPY.circleLeaveStay, style: 'cancel' },
          { text: COPY.circleLeaveGo, style: 'destructive', onPress: doLeave },
        ]}
        onClose={() => { if (isCurrentContext()) setConfirmLeave(false); }}
      />
    </SafeAreaView>
  );
}

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!GROUPS_ENABLED || !id) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CircleDetail circleId={id} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.headerVPad,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  headerSpacer: { width: CIRCLE_HOME.headerIcon },
  profileAction: { marginLeft: 4, flexShrink: 0 },
  scroll: { paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});

const staged = StyleSheet.create({
  container: { backgroundColor: AfterglowColors.paper },
  header: { paddingHorizontal: 12, paddingVertical: 4 },
  headerTitle: { minWidth: 0, marginHorizontal: 4, textAlign: 'left' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  retry: { borderColor: AfterglowColors.clay, borderRadius: 4, minHeight: 44, justifyContent: 'center' },
});
