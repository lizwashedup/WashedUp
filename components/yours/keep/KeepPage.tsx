import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { router } from 'expo-router';
import { ChevronLeft, MoreHorizontal, MessageCircle, CalendarPlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { RADII } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { buildComposerWithPerson } from '../../../lib/composerLink';
import { formatPlanWhenLA } from '../../../lib/planTime';
import { formatEventDateLA } from '../../../lib/laDate';
import { useProfileCard } from '../../../hooks/useProfileCard';
import { useMyFace } from '../../../hooks/useMyFace';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { useGetOrCreateDm, isObsoleteDmOperation } from '../../../hooks/useGetOrCreateDm';
import { usePeopleConnectionMutations, friendlyConnectionError, isObsoletePeopleConnection } from '../../../hooks/usePeopleConnectionMutations';
import { BrandedAlert } from '../../BrandedAlert';
import ProfileButton from '../../ProfileButton';
import KeepHero from './KeepHero';
import StoryTimeline from './StoryTimeline';

export interface KeepPageProps { userId: string; targetId: string; appearance?: { fonts: AfterglowFontFamilies } }
type Visit = { focused: boolean; retired: boolean };
type Work = { visit: Visit; kind: 'message' | 'add' | 'remove' | 'privacy' };

/** Upcoming plans use the same LA clock as their cards. A date-only legacy
 * value can show its day without inventing a time; malformed dates stay out. */
function upcomingWhen(iso: string): string {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    if (new Date(iso).toISOString().slice(0, 10) !== iso) return '';
    return formatEventDateLA(iso);
  }
  return formatPlanWhenLA(iso);
}

/** Relationship/history page, preserving the individual profile as a separate destination. */
export default function KeepPage(props: KeepPageProps) {
  return <ObservedKeepPage key={JSON.stringify([props.userId, props.targetId])} {...props} />;
}
function ObservedKeepPage(props: KeepPageProps) {
  const viewer = useObservedUser();
  return <KeepVisit key={JSON.stringify([viewer.viewerId, viewer.epoch])} {...props} viewer={viewer} />;
}
function KeepVisit({ userId, targetId, appearance, viewer }: KeepPageProps & { viewer: ObservedUser }) {
  const fonts = appearance?.fonts;
  const styles = useMemo(() => fonts ? { ...baseStyles, ...statusStyles, ...keepAppearance(fonts) } : { ...baseStyles, ...statusStyles }, [fonts]);
  const focused = useIsFocused();
  const mounted = useRef(false);
  const visit = useRef<Visit>({ focused, retired: false });
  if (visit.current.focused !== focused) visit.current = { focused, retired: false };
  const capturedVisit = visit.current;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identityReady = !!userId && viewer.viewerId === userId && !viewer.error && !viewer.isLoading && viewer.isCurrent();
  const identity = useRef(identityReady); identity.current = identityReady;
  const isCurrent = () => mounted.current && identity.current && viewer.isCurrent() && visit.current === capturedVisit && capturedVisit.focused && !capturedVisit.retired;
  const profile = useProfileCard(identityReady ? userId : null, identityReady ? targetId : null);
  const { data: rawCard, isLoading, isFetching, isError, refetch } = profile;
  const card = identityReady && !isError && rawCard?.user_id === targetId ? rawCard : null;
  const currentCard = useRef(card); currentCard.current = card;
  const myFaceQuery = useMyFace(identityReady ? userId : null);
  const myFace = identityReady && !myFaceQuery.isError ? myFaceQuery.data : null;
  const { sendRequest, remove, setVisibility } = usePeopleConnectionMutations(userId);
  const getOrCreateDm = useGetOrCreateDm();
  const pending = useRef<Work | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [feedback, setFeedback] = useState<{ visit: Visit; text: string; error: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<Visit | null>(null);
  const confirmationRef = useRef(confirmation); confirmationRef.current = confirmation;
  const [messagePressed, setMessagePressed] = useState(false), [planPressed, setPlanPressed] = useState(false);
  const busy = work?.visit === capturedVisit ? work.kind : null;
  const message = feedback?.visit === capturedVisit ? feedback : null;
  const fullCurrent = () => isCurrent() && currentCard.current?.kind === 'full';
  const report = (text: string, error = true) => { if (isCurrent()) setFeedback({ visit: capturedVisit, text, error }); };
  const begin = (kind: Work['kind']) => {
    if (!isCurrent() || (pending.current?.visit === capturedVisit)) return null;
    const attempt = { visit: capturedVisit, kind }; pending.current = attempt; setWork(attempt); setFeedback(null); return attempt;
  };
  const finish = (attempt: Work) => {
    if (pending.current !== attempt) return;
    pending.current = null; if (isCurrent()) setWork(null);
  };
  const navigate = (destination?: string) => {
    if (!isCurrent()) return;
    capturedVisit.retired = true;
    if (destination) router.push(destination as never); else router.back();
  };
  const back = () => {
    if (!mounted.current || visit.current !== capturedVisit || capturedVisit.retired || !focused) return;
    capturedVisit.retired = true; router.back();
  };
  const onMessage = async () => {
    if (!fullCurrent()) return; const attempt = begin('message'); if (!attempt) return; hapticSelection();
    try {
      const circleId = await getOrCreateDm.mutateAsync(targetId);
      if (!isCurrent() || pending.current !== attempt || !fullCurrent()) return;
      if (typeof circleId !== 'string' || !circleId.trim()) throw new Error('Unconfirmed chat');
      navigate(`/(tabs)/chats/circle/${circleId}`);
    } catch (error) { if (!isObsoleteDmOperation(error)) report(COPY.keepMessageError); }
    finally { finish(attempt); }
  };
  const onInvite = () => {
    if (!fullCurrent() || pending.current?.visit === capturedVisit) return; const person = currentCard.current!; hapticSelection();
    navigate(buildComposerWithPerson(person.user_id, person.first_name_display, person.profile_photo_url));
  };
  const onAdd = async () => {
    if (!isCurrent() || currentCard.current?.kind !== 'minimal') return; const attempt = begin('add'); if (!attempt) return;
    try {
      const outcome = await sendRequest.mutateAsync({ recipientId: targetId, context: 'handle_lookup' }, { scope: { userId, isCurrent } });
      if (!isCurrent() || pending.current !== attempt) return;
      if (outcome !== 'requested' && outcome !== 'now_connected' && outcome !== 'already_connected') throw new Error('Unconfirmed request');
      navigate();
    } catch (error) { if (!isObsoletePeopleConnection(error)) report(friendlyConnectionError(error)); }
    finally { finish(attempt); }
  };
  const onHidePlans = async () => {
    if (!fullCurrent()) return; const attempt = begin('privacy'); if (!attempt) return;
    try {
      await setVisibility.mutateAsync({ personId: targetId, hidden: true }, { scope: { userId, isCurrent, canDispatch: fullCurrent } });
      if (isCurrent() && pending.current === attempt) report('Your upcoming plans are hidden from this person.', false);
    } catch (error) { if (!isObsoletePeopleConnection(error)) report('Couldn’t update your privacy setting. Try again.'); }
    finally { finish(attempt); }
  };
  const onRemove = async () => {
    if (!fullCurrent() || confirmationRef.current !== capturedVisit) return; const attempt = begin('remove'); if (!attempt) return;
    try {
      await remove.mutateAsync(targetId, { scope: { userId, isCurrent, canDispatch: fullCurrent } });
      if (isCurrent() && pending.current === attempt) navigate();
    } catch (error) { if (!isObsoletePeopleConnection(error) && isCurrent()) { confirmationRef.current = null; setConfirmation(null); report(COPY.ppRemoveError); } }
    finally { finish(attempt); }
  };
  const openMore = () => {
    if (!fullCurrent() || pending.current?.visit === capturedVisit) return;
    Alert.alert(currentCard.current?.first_name_display || 'This person', undefined, [
      { text: COPY.privacyToggle(currentCard.current?.first_name_display || 'them'), onPress: () => { if (fullCurrent()) void onHidePlans(); } },
      { text: COPY.profileRemove, style: 'destructive', onPress: () => { if (fullCurrent() && pending.current?.visit !== capturedVisit) { confirmationRef.current = capturedVisit; setConfirmation(capturedVisit); } } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const closeConfirmation = () => { if (isCurrent()) { confirmationRef.current = null; setConfirmation(null); } };
  const name = card?.first_name_display?.trim() || 'them';
  const color = fonts ? AfterglowColors.ink : Colors.asphalt;
  const isEmpty = !!card && card.shared_count === 0 && !card.adventures?.length && !card.upcoming?.length;
  const waiting = (viewer.isLoading && !viewer.error) || (identityReady && (isLoading || (isFetching && !card)));
  const retry = () => { if (isCurrent() && !isFetching) void refetch(); };
  const currentMessage = message ? <Text style={message.error ? styles.feedbackError : styles.feedbackSuccess} accessibilityRole={message.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{message.text}</Text> : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={back} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={24} color={color} /></Pressable>
        <View style={styles.topActions}>
          {card?.kind === 'full' && <Pressable onPress={openMore} style={styles.iconBtn} disabled={!!busy} accessibilityRole="button" accessibilityLabel="More options" accessibilityState={{ disabled: !!busy }}><MoreHorizontal size={22} color={color} /></Pressable>}
          <ProfileButton compact />
        </View>
      </View>
      {waiting ? (
        <View style={styles.center}><ActivityIndicator color={fonts ? AfterglowColors.clay : Colors.terracotta} accessibilityLabel="Loading your shared plans" /><Text style={styles.statusText}>Loading your shared plans…</Text></View>
      ) : viewer.error ? (
        <View style={styles.center}><Text style={styles.statusTitle}>Couldn’t check your account.</Text><Pressable style={styles.retry} onPress={() => { if (mounted.current && visit.current === capturedVisit && !capturedVisit.retired) void viewer.retry(); }} accessibilityRole="button" accessibilityLabel="Try again to check account"><Text style={styles.retryText} numberOfLines={1}>Try again</Text></Pressable></View>
      ) : isError && identityReady ? (
        <View style={styles.center}><Text style={styles.statusTitle}>Couldn’t load this page.</Text><Pressable style={styles.retry} onPress={retry} accessibilityRole="button" accessibilityLabel="Try again to load shared plans"><Text style={styles.retryText} numberOfLines={1}>Try again</Text></Pressable></View>
      ) : !card ? (
        <View style={styles.center}><Text style={styles.statusTitle}>This page isn’t available.</Text><Text style={styles.statusText}>Go back to your people to keep looking.</Text></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <KeepHero myName={myFace?.first_name_display ?? 'You'} myPhoto={myFace?.profile_photo_url ?? null}
            theirName={card.first_name_display} theirPhoto={card.profile_photo_url} plansCount={card.shared_count}
            albumsCount={card.kind === 'full' ? card.adventures?.length ?? 0 : 0} comingUpCount={card.kind === 'full' ? card.upcoming?.length ?? 0 : 0}
            sinceDate={card.kind === 'full' ? card.since_date : null} hideStats={isEmpty} appearance={appearance} />
          {currentMessage}
          {card.kind === 'minimal' ? (
            <View style={styles.minimal}><Pressable style={[styles.primaryBtn, busy && styles.actionDisabled]} onPress={() => { void onAdd(); }} disabled={!!busy} accessibilityRole="button" accessibilityLabel={busy === 'add' ? `Sending request to ${name}` : `Add ${name}`} accessibilityState={{ disabled: !!busy, busy: busy === 'add' }}><Text style={styles.primaryText} numberOfLines={1}>{busy === 'add' ? 'Sending…' : 'Add'}</Text></Pressable></View>
          ) : (
            <>
              <View style={styles.actions}>
                <Pressable style={[styles.actionBtn, styles.actionGold, messagePressed && styles.actionPressed, busy && styles.actionDisabled]}
                  onPress={() => { void onMessage(); }} onPressIn={() => setMessagePressed(true)} onPressOut={() => setMessagePressed(false)} disabled={!!busy}
                  accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: busy === 'message' }} accessibilityLabel={busy === 'message' ? `Opening chat with ${name}` : `Message ${name}`}>
                  {busy === 'message' ? <ActivityIndicator color={color} /> : <><MessageCircle size={16} color={color} /><Text style={styles.actionGoldText} numberOfLines={1}>Message</Text></>}
                </Pressable>
                <Pressable style={[styles.actionBtn, styles.actionPrimary, planPressed && styles.actionPressed, busy && styles.actionDisabled]}
                  onPress={onInvite} onPressIn={() => setPlanPressed(true)} onPressOut={() => setPlanPressed(false)} disabled={!!busy}
                  accessibilityRole="button" accessibilityLabel="Make a plan" accessibilityState={{ disabled: !!busy }}>
                  <CalendarPlus size={16} color={fonts ? AfterglowColors.white : Colors.white} /><Text style={styles.actionPrimaryText} numberOfLines={1}>Make a plan</Text>
                </Pressable>
              </View>
              {!!card.upcoming?.length && <View style={styles.section}>
                <Text style={styles.sectionLabel}>{fonts ? `${name}’s upcoming plans` : COPY.keepComingUp(card.first_name_display)}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fonts ? styles.upcomingContent : undefined}>
                  {card.upcoming.map(u => {
                    const when = fonts ? upcomingWhen(u.start_time) : '';
                    return <Pressable key={u.event_id} style={styles.upPill} onPress={() => { if (fullCurrent() && currentCard.current?.upcoming?.some(plan => plan.event_id === u.event_id)) navigate(`/plan/${u.event_id}`); }} accessibilityRole="button" accessibilityLabel={`View plan, ${u.title}${when ? `, ${when}` : ''}`}>
                      <Text style={styles.upText} numberOfLines={fonts ? undefined : 1}>{u.title}</Text>
                      {!!when && <Text style={styles.upDate}>{when}</Text>}
                    </Pressable>;
                  })}
                </ScrollView>
              </View>}
              {isEmpty ? <View style={styles.emptyBlock}><Text style={styles.emptyHeadline}>{fonts ? 'Your next plan starts here.' : COPY.keepEmptyHeadline(name)}</Text>{fonts ? <Text style={styles.statusText}>Pick something you’d both enjoy.</Text> : <Pressable style={styles.emptyActionButton} onPress={onInvite} accessibilityRole="button" accessibilityLabel="Make a plan"><Text style={styles.emptyAction}>Make a plan</Text></Pressable>}</View> : <>
                <View style={styles.section}><Text style={styles.sectionLabel}>{fonts ? 'Shared memories' : COPY.keepStorySoFar}</Text><StoryTimeline adventures={card.adventures ?? []} theirName={card.first_name_display} appearance={appearance} onOpenAlbum={eventId => { if (fullCurrent() && currentCard.current?.adventures?.some(album => album.event_id === eventId)) navigate(`/album/${eventId}`); }} /></View>
                <Text style={styles.closing}>{COPY.keepClosing}</Text>
              </>}
            </>
          )}
        </ScrollView>
      )}
      {fonts ? <KeepRemovalDialog visible={confirmation === capturedVisit && focused && !!card && card.kind === 'full'} busy={busy === 'remove'} onClose={closeConfirmation} onRemove={() => { void onRemove(); }} fonts={fonts} /> :
        <BrandedAlert visible={confirmation === capturedVisit && focused && !!card && card.kind === 'full'} title={COPY.profileRemove} message={COPY.removeConfirm} scrollMessage buttons={[{ text: 'Cancel', style: 'cancel' }, { text: busy === 'remove' ? 'Removing…' : 'Remove', style: 'destructive', onPress: () => { void onRemove(); } }]} onClose={closeConfirmation} />}
    </SafeAreaView>
  );
}
function KeepRemovalDialog({ visible, busy, onClose, onRemove, fonts }: { visible: boolean; busy: boolean; onClose: () => void; onRemove: () => void; fonts: AfterglowFontFamilies }) {
  const { height } = useWindowDimensions();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onAccessibilityEscape={onClose}>
    <View style={dialogStyles.overlay}><View style={[dialogStyles.card, { maxHeight: Math.max(0, height - 48) }]} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={dialogStyles.content} keyboardShouldPersistTaps="handled"><Text style={[dialogStyles.title, { fontFamily: fonts.semibold }]}>Remove from your people?</Text><Text style={[dialogStyles.body, { fontFamily: fonts.regular }]}>{COPY.removeConfirm}</Text></ScrollView>
      <View style={dialogStyles.buttons}><Pressable style={dialogStyles.cancel} onPress={onClose} accessibilityRole="button" accessibilityLabel={busy ? 'Close' : 'Cancel'}><Text style={[dialogStyles.cancelText, { fontFamily: fonts.semibold }]} numberOfLines={1}>{busy ? 'Close' : 'Cancel'}</Text></Pressable><Pressable style={dialogStyles.remove} onPress={onRemove} disabled={busy} accessibilityRole="button" accessibilityLabel={busy ? 'Removing person' : 'Remove person'} accessibilityState={{ disabled: busy, busy }}><Text style={[dialogStyles.removeText, { fontFamily: fonts.semibold }]} numberOfLines={1}>{busy ? 'Removing…' : 'Remove'}</Text></Pressable></View>
    </View></View>
  </Modal>;
}
const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 48 },
  minimal: { paddingHorizontal: 24, gap: 8 },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 22,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADII.button,
    paddingVertical: 14,
    minHeight: 44,
  },
  actionDisabled: { opacity: 0.55 },
  actionPressed: { opacity: 0.8 },
  actionPrimary: { backgroundColor: Colors.terracotta },
  actionPrimaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  // Gold = low-pressure "warm nudge", in deliberate contrast to the
  // terracotta "do this now" invite. Documented gold-button exception in
  // CLAUDE.md (same framing as the "I'd go next time" button).
  actionGold: { backgroundColor: Colors.goldAccent },
  actionGoldText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  section: { marginTop: 28, gap: 12 },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
  },
  upPill: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginLeft: 20,
    maxWidth: 240,
  },
  upText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  upDate: {},
  upcomingContent: {},

  closing: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 32,
    paddingHorizontal: 24,
  },
  emptyBlock: { alignItems: 'center', marginTop: 40, paddingHorizontal: 32, gap: 14 },
  emptyHeadline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.secondary,
    textAlign: 'center',
  },
  emptyAction: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: RADII.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});

const statusStyles = StyleSheet.create({
  statusText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center', marginTop: 12 },
  statusTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', marginTop: 16 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  feedbackError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed, marginHorizontal: 20, marginTop: 16 },
  feedbackSuccess: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginHorizontal: 20, marginTop: 16 },
  emptyActionButton: { minHeight: 44, justifyContent: 'center' },
});
function keepAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
    center: { ...baseStyles.center, paddingHorizontal: 24 },
    topBar: { ...baseStyles.topBar, paddingHorizontal: 12 },
    actions: { ...baseStyles.actions, marginTop: 20 },
    actionBtn: { ...baseStyles.actionBtn, borderRadius: 5, minHeight: 48 },
    actionGold: { backgroundColor: Colors.goldAccent },
    actionGoldText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    actionPrimary: { backgroundColor: AfterglowColors.clay },
    actionPrimaryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
    section: { ...baseStyles.section, marginTop: 26 },
    sectionLabel: { ...baseStyles.sectionLabel, ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.clay, textTransform: 'none', letterSpacing: 0 },
    upPill: { ...baseStyles.upPill, backgroundColor: AfterglowColors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: AfterglowColors.line, borderRadius: 5, minHeight: 48, paddingVertical: 12 },
    upText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    upDate: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
    upcomingContent: { paddingRight: 20 },
    closing: { ...baseStyles.closing, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 24 },
    emptyHeadline: { ...baseStyles.emptyHeadline, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    emptyAction: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    primaryBtn: { ...baseStyles.primaryBtn, backgroundColor: AfterglowColors.clay, borderRadius: 5, minHeight: 48 },
    primaryText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
    statusText: { ...statusStyles.statusText, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    statusTitle: { ...statusStyles.statusTitle, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    feedbackError: { ...statusStyles.feedbackError, ...AfterglowType.body, fontFamily: fonts.regular },
    feedbackSuccess: { ...statusStyles.feedbackSuccess, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  });
}
const dialogStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, padding: 24, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 360, borderRadius: 8, backgroundColor: AfterglowColors.paper, padding: 20 },
  content: { gap: 12, paddingBottom: 20 },
  title: { ...AfterglowType.contextTitle, color: AfterglowColors.ink },
  body: { ...AfterglowType.body, color: AfterglowColors.muted },
  buttons: { flexDirection: 'row', gap: 12, flexShrink: 0 },
  cancel: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  remove: { flex: 1, minHeight: 44, backgroundColor: AfterglowColors.clay, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...AfterglowType.body, color: AfterglowColors.ink },
  removeText: { ...AfterglowType.body, color: AfterglowColors.white },
});
