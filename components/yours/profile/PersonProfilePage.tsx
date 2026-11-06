import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  MessageCircle,
  CalendarPlus,
  UserMinus,
  Flag,
} from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { useQueryClient } from '@tanstack/react-query';
import { buildComposerWithPerson } from '../../../lib/composerLink';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { usePersonProfile } from '../../../hooks/usePersonProfile';
import { useGetOrCreateDm, isObsoleteDmOperation } from '../../../hooks/useGetOrCreateDm';
import { usePeopleConnectionMutations, isObsoletePeopleConnection } from '../../../hooks/usePeopleConnectionMutations';
import { useBlock } from '../../../hooks/useBlock';
import { BrandedAlert } from '../../BrandedAlert';
import MenuCard, { type AnchorRect } from '../../menu/MenuCard';
import { AppearanceContext, useProfileStyles, fmtMonthYear, MutualFaces, TopBar, Avatar, SectionLabel, UpcomingRow, PastRow, type Appearance } from './PersonProfilePresentation';

/**
 * The individual profile page ("just {name}"): the keep page's visual
 * language, solo. Mutuals-only and viewer-visible filtering are enforced by
 * get_person_profile server-side; the client never re-implements the gate, and
 * a null payload (denied / severed / nonexistent) renders an identical quiet
 * not-found. No albums (those are keep-page only). Source:
 * individual-profile-page-spec.md.
 */
export interface PersonProfilePageProps {
  userId: string;
  targetId: string;
  appearance?: Appearance;
}
type Visit = { focused: boolean; retired: boolean };
type MenuVisit = { visit: Visit; action: 'message' | 'plan' | 'remove' | 'block' | null };
export default function PersonProfilePage(props: PersonProfilePageProps) {
  return <AppearanceContext.Provider value={props.appearance}><ObservedProfile key={JSON.stringify([props.userId, props.targetId])} {...props}/></AppearanceContext.Provider>;
}
function ObservedProfile(props: PersonProfilePageProps) {
  const viewer = useObservedUser();
  return <ProfileVisit key={JSON.stringify([viewer.viewerId, viewer.epoch])} {...props} viewer={viewer}/>;
}
function ProfileVisit({ userId, targetId, viewer }: PersonProfilePageProps & { viewer: ObservedUser }) {
  const client = useQueryClient();
  const { styles, appearance } = useProfileStyles();
  const focused = useIsFocused();
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identityReady = viewer.viewerId === userId && !!userId && !viewer.error && !viewer.isLoading && viewer.isCurrent();
  const identity = useRef(identityReady); identity.current = identityReady;
  const accountCurrent = useCallback(() => mounted.current && identity.current && viewer.isCurrent(), [viewer.isCurrent]);
  const readScope = useMemo(() => ({ userId, epoch: viewer.epoch, isCurrent: accountCurrent }), [userId, viewer.epoch, accountCurrent]);
  const query = usePersonProfile(identityReady ? userId : null, identityReady ? targetId : null, readScope);
  const profile = identityReady && !query.isError && query.data?.user_id === targetId ? query.data : null;
  const latestProfile = useRef(profile); latestProfile.current = profile;
  const visitRef = useRef<Visit>({ focused, retired: false });
  if (visitRef.current.focused !== focused) visitRef.current = { focused, retired: false };
  const visit = visitRef.current;
  const isCurrent = useCallback(() => accountCurrent() && visitRef.current === visit && visit.focused && !visit.retired, [accountCurrent, visit]);
  const readable = () => isCurrent() && latestProfile.current?.user_id === targetId;
  const getOrCreateDm = useGetOrCreateDm();
  const { remove } = usePeopleConnectionMutations(userId);
  const { blockUser, blocking } = useBlock();
  const pending = useRef<{ visit: Visit; kind: 'message' | 'remove' | 'retry' } | null>(null);
  const [work, setWork] = useState<typeof pending.current>(null);
  const busy = work?.visit === visit ? work.kind : null;
  const [feedback, setFeedback] = useState<{ visit: Visit; text: string } | null>(null);
  const report = (text: string) => { if (isCurrent()) setFeedback({ visit, text }); };
  const begin = (kind: NonNullable<typeof pending.current>['kind']) => {
    if (!isCurrent() || blocking || pending.current?.visit === visit) return null;
    const attempt = { visit, kind }; pending.current = attempt; setWork(attempt); setFeedback(null); return attempt;
  };
  const finish = (attempt: NonNullable<typeof pending.current>) => {
    if (pending.current !== attempt) return;
    pending.current = null; if (isCurrent()) setWork(null);
  };
  const navigate = (href?: string) => {
    if (!isCurrent()) return;
    visit.retired = true;
    try { if (href) router.push(href as never); else router.back(); }
    catch { visit.retired = false; report('Couldn’t open that page. Try again.'); }
  };
  const back = () => {
    if (!mounted.current || visitRef.current !== visit || !visit.focused || visit.retired) return;
    visit.retired = true; router.back();
  };
  const [messagePressed, setMessagePressed] = useState(false), [planPressed, setPlanPressed] = useState(false);
  const [menu, setMenu] = useState<{ session: MenuVisit; anchor: AnchorRect; open: boolean } | null>(null);
  const activeMenu = useRef<MenuVisit | null>(null);
  const [confirmation, setConfirmation] = useState<Visit | null>(null);
  const confirmationRef = useRef(confirmation); confirmationRef.current = confirmation;
  const onMessage = async () => {
    if (!readable()) return; const attempt = begin('message'); if (!attempt) return; hapticSelection();
    try {
      const circleId = await getOrCreateDm.mutateAsync(targetId, { scope: { userId, isCurrent: readable } });
      if (!readable() || pending.current !== attempt) return;
      if (typeof circleId !== 'string' || !circleId.trim()) throw new Error('Unconfirmed chat');
      navigate(`/(tabs)/chats/circle/${circleId}`);
    } catch (error) { if (!isObsoleteDmOperation(error)) report(COPY.keepMessageError); }
    finally { finish(attempt); }
  };
  const onMakePlan = () => {
    if (!readable() || pending.current?.visit === visit || blocking) return;
    const person = latestProfile.current!; hapticSelection();
    navigate(buildComposerWithPerson(client, userId, person.user_id, person.first_name_display, person.profile_photo_url));
  };
  const onMore = (anchor: AnchorRect) => {
    if (!readable() || pending.current?.visit === visit || blocking || activeMenu.current?.visit === visit) return;
    const session: MenuVisit = { visit, action: null }; activeMenu.current = session; setMenu({ session, anchor, open: true });
  };
  const queueMenu = (action: MenuVisit['action']) => {
    if (!readable() || !menu || activeMenu.current !== menu.session || menu.session.visit !== visit || menu.session.action) return;
    menu.session.action = action;
  };
  const closeMenu = () => {
    if (!isCurrent() || !menu || activeMenu.current !== menu.session) return;
    setMenu({ ...menu, open: false });
  };
  const onMenuClosed = () => {
    if (!readable() || !menu || activeMenu.current !== menu.session || menu.session.visit !== visit) return;
    const action = menu.session.action; activeMenu.current = null; setMenu(null);
    if (action === 'message') void onMessage();
    else if (action === 'plan') onMakePlan();
    else if (action === 'remove') { confirmationRef.current = visit; setConfirmation(visit); }
    else if (action === 'block') {
      const person = latestProfile.current!;
      void blockUser(targetId, person.first_name_display?.trim() || 'this person', () => { if (isCurrent()) navigate(); }, { userId, isCurrent });
    }
  };
  const doRemove = async () => {
    if (!readable() || confirmationRef.current !== visit) return; const attempt = begin('remove'); if (!attempt) return;
    try {
      await remove.mutateAsync(targetId, { scope: { userId, isCurrent, canDispatch: readable } });
      if (isCurrent() && pending.current === attempt) navigate();
    } catch (error) {
      if (!isObsoletePeopleConnection(error) && isCurrent()) {
        confirmationRef.current = null; setConfirmation(null); report(COPY.ppRemoveError);
      }
    } finally { finish(attempt); }
  };
  const closeConfirmation = () => { if (isCurrent()) { confirmationRef.current = null; setConfirmation(null); } };
  const openPlan = (id: string) => {
    if (!readable() || pending.current?.visit === visit || blocking) return;
    const person = latestProfile.current!;
    if (![...(person.upcoming ?? []), ...(person.past ?? [])].some(plan => plan.event_id === id)) return;
    navigate(`/plan/${id}`);
  };
  const goKeep = () => { if (readable() && pending.current?.visit !== visit && !blocking) navigate(`/person/${targetId}`); };
  const retry = async () => {
    if (query.isFetching) return; const attempt = begin('retry'); if (!attempt) return;
    try { await query.refetch(); } catch { /* The query owns its retry error. */ } finally { finish(attempt); }
  };
  const name = profile?.first_name_display?.trim() || 'them';
  const handle = profile?.handle?.trim().replace(/^@+/, '');
  const waiting = viewer.isLoading || (identityReady && (query.isLoading || (query.isFetching && !profile))) || busy === 'retry';
  const currentFeedback = feedback?.visit === visit ? feedback.text : null;
  const color = appearance ? AfterglowColors.ink : Colors.asphalt;
  const topBar = <TopBar onBack={back} onMore={profile ? onMore : undefined} busy={!!busy || blocking}/>;
  if (waiting || viewer.error || !identityReady || query.isError || !profile) {
    return <SafeAreaView style={styles.container} edges={['top']}>{topBar}<View style={styles.center}>
      {waiting ? <><ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta} accessibilityLabel="Loading profile"/><Text style={styles.statusText}>Loading profile…</Text></> :
       viewer.error ? <><Text style={styles.statusTitle}>Couldn’t check your account.</Text><Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Try again to check account" onPress={() => { if (mounted.current && visitRef.current === visit && focused && !visit.retired) void viewer.retry(); }}><Text style={styles.retryText}>Try again</Text></Pressable></> :
       identityReady && query.isError ? <><Text style={styles.statusTitle}>Couldn’t load this profile.</Text><Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Try again to load profile" onPress={() => { void retry(); }}><Text style={styles.retryText}>Try again</Text></Pressable></> :
       <Text style={styles.notFound}>{appearance ? 'This profile isn’t available.' : COPY.ppNotFound}</Text>}
    </View></SafeAreaView>;
  }

  // Defensive: the RPC coalesces these to [] / 0, but never deref a null array.
  const upcoming = profile.upcoming ?? [];
  const past = profile.past ?? [];
  const mutualFaces = profile.mutual_faces ?? [];
  const vibeTags = profile.vibe_tags ?? [];
  const hasUpcoming = upcoming.length > 0;
  const hasPast = past.length > 0;
  const isBrandNew = profile.upcoming_count === 0 && profile.past_total === 0;
  const moreInPast = profile.past_total - past.length;

  // Stats line, anti-zero: drop any zero, render nothing if both are zero.
  const statParts: string[] = [];
  if (profile.past_total > 0) statParts.push(COPY.ppStatPlans(profile.past_total));
  if (profile.upcoming_count > 0) statParts.push(COPY.ppStatComingUp(profile.upcoming_count));

  // Trust line, anti-zero: joined is always shown; plans-created + phone-verified
  // only when real. The warm new-here marker stands in for the track record while
  // new (never "unproven" framing). Honest signals only.
  const joined = fmtMonthYear(profile.joined_at);
  const trustParts: string[] = joined ? [COPY.ppJoined(joined)] : [];
  if (!profile.is_new && profile.plans_created > 0) {
    trustParts.push(COPY.ppCreated(profile.plans_created));
  }
  if (profile.phone_verified) trustParts.push(COPY.ppPhoneVerified);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {topBar}
      <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.identityRow}>
          <Avatar name={profile.first_name_display} photoUrl={profile.profile_photo_url} />
          <View style={styles.identityText}><Text style={styles.name}>{name}</Text>{!!handle && <Text style={styles.handle}>{`@${handle}`}</Text>}</View>
        </View>

        {profile.neighborhood ? (
          <Text style={styles.place}>{profile.neighborhood}</Text>
        ) : null}

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {vibeTags.length > 0 && (
          <View style={styles.tags}>
            {vibeTags.map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        <MutualFaces faces={mutualFaces} total={profile.mutual_count} />

        {profile.is_new ? <Text style={styles.newHere}>{COPY.ppNewHere}</Text> : null}
        {!!trustParts.length && <Text style={styles.trust}>{trustParts.join(' · ')}</Text>}
        {!!currentFeedback && <Text style={styles.feedback} accessibilityRole="alert">{currentFeedback}</Text>}

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, styles.actionGold, messagePressed && styles.actionPressed, (busy === 'message') && styles.actionDisabled]}
            onPress={() => { void onMessage(); }}
            onPressIn={() => setMessagePressed(true)}
            onPressOut={() => setMessagePressed(false)}
            disabled={!!busy || blocking}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!busy || blocking, busy: busy === 'message' }}
            accessibilityLabel={busy === 'message' ? `Opening chat with ${name}` : `Message ${name}`}
          >
            {(busy === 'message') ? (
              <ActivityIndicator color={color} />
            ) : (
              <>
                <MessageCircle size={16} color={color} />
                <Text style={styles.actionGoldText} numberOfLines={1}>Message</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionPrimary, planPressed && styles.actionPressed]}
            onPress={onMakePlan}
            disabled={!!busy || blocking}
            accessibilityState={{ disabled: !!busy || blocking }}
            onPressIn={() => setPlanPressed(true)}
            onPressOut={() => setPlanPressed(false)}
            accessibilityRole="button"
            accessibilityLabel="Make a plan"
          >
            <CalendarPlus size={16} color={Colors.white} />
            <Text style={styles.actionPrimaryText} numberOfLines={1}>{appearance ? 'Make a plan' : COPY.keepMakePlan}</Text>
          </Pressable>
        </View>

        {/* The two pages point at each other. */}
        <Pressable onPress={goKeep} hitSlop={8} style={styles.keepLink} accessibilityRole="button" accessibilityLabel={`View your shared plans with ${name}`}>
          <Text style={styles.keepLinkText}>{appearance ? 'Your shared plans' : COPY.ppKeepLink(name)}</Text>
        </Pressable>

        {isBrandNew ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyHeadline}>{COPY.ppBrandNew(name)}</Text>
          </View>
        ) : (
          <>
            {hasUpcoming && (
              <View style={styles.section}>
                <SectionLabel>{COPY.profileComingUp}</SectionLabel>
                {upcoming.map((u) => (
                  <UpcomingRow key={u.event_id} row={u} onOpen={openPlan} />
                ))}
              </View>
            )}

            {hasPast && (
              <View style={styles.section}>
                <SectionLabel>{appearance ? 'Past plans' : COPY.ppStorySoFar}</SectionLabel>
                {past.map((p) => (
                  <PastRow key={p.event_id} row={p} onOpen={openPlan} />
                ))}
                {moreInPast > 0 && (
                  <Text style={styles.moreCount}>{`and ${moreInPast} more`}</Text>
                )}
              </View>
            )}

            {statParts.length > 0 && (
              <Text style={styles.stats}>{statParts.join(' · ')}</Text>
            )}
          </>
        )}
      </ScrollView>

      <MenuCard key={menu ? `${targetId}:${viewer.epoch}:${menu.session.visit === visit}` : 'closed'}
        appearance={appearance} visible={!!menu && menu.open && menu.session.visit === visit && readable()}
        onClose={closeMenu} onClosed={onMenuClosed} anchor={menu?.anchor ?? null} placement="top-right"
        rows={[
          { key: 'message', icon: MessageCircle, label: COPY.menuMessage, subtitle: COPY.menuMessageSub, onPress: () => queueMenu('message') },
          { key: 'plan', icon: CalendarPlus, label: COPY.menuMakePlan, subtitle: COPY.menuMakePlanSub, onPress: () => queueMenu('plan') },
          { key: 'remove', icon: UserMinus, label: COPY.profileRemove, subtitle: COPY.profileRemoveSub, muted: true, dividerBefore: true, onPress: () => queueMenu('remove') },
          { key: 'report', icon: Flag, label: appearance ? 'Block' : COPY.ppReport, subtitle: appearance ? 'Review before blocking' : COPY.ppReportSub, muted: true, onPress: () => queueMenu('block') },
        ]}
      />
      <BrandedAlert appearance={appearance} visible={confirmation === visit && isCurrent()} title={COPY.profileRemove} message={COPY.removeConfirm}
        buttons={[{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void doRemove(); } }]}
        onClose={closeConfirmation}/>

    </SafeAreaView>
  );
}
