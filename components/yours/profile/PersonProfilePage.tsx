import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  ChevronLeft,
  MoreHorizontal,
  MessageCircle,
  CalendarPlus,
  UserMinus,
  Flag,
} from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { RADII } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { buildComposerWithPerson } from '../../../lib/composerLink';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { usePersonProfile } from '../../../hooks/usePersonProfile';
import { useGetOrCreateDm, isObsoleteDmOperation } from '../../../hooks/useGetOrCreateDm';
import { usePeopleConnectionMutations, isObsoletePeopleConnection } from '../../../hooks/usePeopleConnectionMutations';
import { useBlock } from '../../../hooks/useBlock';
import { BrandedAlert } from '../../BrandedAlert';
import MenuCard, { type AnchorRect } from '../../menu/MenuCard';
import type {
  PersonProfileUpcoming,
  PersonProfilePast,
  PersonProfileMutualFace,
} from '../../../lib/yours/types';
import { initialOf } from '../../../lib/yours/personDisplay';

type Appearance = { fonts: AfterglowFontFamilies };
const AppearanceContext = createContext<Appearance | undefined>(undefined);
function useProfileStyles() {
  const appearance = useContext(AppearanceContext);
  return { appearance, styles: useMemo(() => appearance ? { ...baseStyles, ...profileAppearance(appearance.fonts) } : baseStyles, [appearance]) };
}

/** "Sat, Jun 14", pinned to the LA clock plans live on (no dashes). */
function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** "March 2025", LA clock, for the joined-since trust signal. */
function fmtMonthYear(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** Up to three overlapping mutual faces + "you both know {name} and N others". */
function MutualFaces({
  faces,
  total,
}: {
  faces: PersonProfileMutualFace[];
  total: number;
}) {
  const { styles, appearance } = useProfileStyles();
  if (total <= 0) return null;
  const lead = faces[0]?.first_name_display ?? 'someone';
  return (
    <View style={styles.mutuals}>
      {faces.length > 0 && (
        <View style={styles.mutualStack}>
          {faces.map((f, i) => (
            <View key={f.user_id} style={[styles.mutualFace, i > 0 && styles.mutualFaceOverlap]}>
              <ProfilePhoto key={JSON.stringify([f.user_id, f.profile_photo_url])} name={f.first_name_display} uri={f.profile_photo_url} small />
            </View>
          ))}
        </View>
      )}
      <Text style={styles.mutualText} numberOfLines={appearance ? undefined : 2}>
        {COPY.ppMutuals(lead, total)}
      </Text>
    </View>
  );
}

/** Back chevron always; overflow only when there is a real profile to act on. */
function TopBar({ onMore, onBack, busy = false }: { onMore?: (anchor: AnchorRect) => void; onBack: () => void; busy?: boolean }) {
  const { styles, appearance } = useProfileStyles();
  const color = appearance ? AfterglowColors.ink : Colors.asphalt;
  const moreRef = useRef<View>(null);
  const press = () => {
    if (!onMore) return;
    moreRef.current?.measureInWindow((x, y, width, height) =>
      onMore({ x, y, width, height }),
    );
  };
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeft size={24} color={color} />
      </Pressable>
      {onMore ? (
        <Pressable
          ref={moreRef}
          onPress={press}
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          hitSlop={12}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <MoreHorizontal size={22} color={color} />
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

function ProfilePhoto({ name, uri, small = false }: { name: string | null; uri: string | null; small?: boolean }) {
  const { styles } = useProfileStyles();
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return uri && !failed ? <Image source={{ uri }} style={small ? styles.mutualImg : styles.avatarImg} contentFit="cover"
    recyclingKey={uri} onError={() => { if (mounted.current) setFailed(true); }} /> :
    <Text style={small ? styles.mutualInitial : styles.avatarInitial}>{initialOf(name)}</Text>;
}
function Avatar({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const { styles } = useProfileStyles();
  return <View style={styles.avatar}><ProfilePhoto key={JSON.stringify([name, photoUrl])} name={name} uri={photoUrl}/></View>;
}

function SectionLabel({ children }: { children: string }) {
  const { styles } = useProfileStyles();
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function UpcomingRow({ row, onOpen }: { row: PersonProfileUpcoming; onOpen: (id: string) => void }) {
  const { styles, appearance } = useProfileStyles();
  const [pressed, setPressed] = useState(false);
  const date = fmtDate(row.start_time);
  return (
    <Pressable
      onPress={() => onOpen(row.event_id)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${date}.`}
    >
      <View style={styles.dateDot} />
      <View style={styles.planText}>
        <Text style={styles.planTitle} numberOfLines={appearance ? undefined : 1}>
          {row.title}
        </Text>
        <Text style={styles.planMeta} numberOfLines={appearance ? undefined : 1}>
          {row.neighborhood ? `${date} · ${row.neighborhood}` : date}
        </Text>
      </View>
    </Pressable>
  );
}

function PastRow({ row, onOpen }: { row: PersonProfilePast; onOpen: (id: string) => void }) {
  const { styles, appearance } = useProfileStyles();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={() => onOpen(row.event_id)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${fmtDate(row.date)}.`}
    >
      <Text style={styles.pastDate}>{fmtDate(row.date)}</Text>
      <Text style={styles.pastTitle} numberOfLines={appearance ? undefined : 1}>
        {row.title}
      </Text>
    </Pressable>
  );
}

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
    navigate(buildComposerWithPerson(person.user_id, person.first_name_display, person.profile_photo_url));
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

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  identityRow: {}, identityText: {},
  handle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center', marginTop: 4 },
  statusTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, textAlign: 'center' },
  statusText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 10 },
  retry: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 12, marginTop: 16, justifyContent: 'center' },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  feedback: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed, paddingHorizontal: 20, marginTop: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  iconBtn: { padding: 8, minWidth: 40 },
  scroll: { paddingBottom: 48, paddingTop: 8 },

  notFound: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.tertiary,
  },

  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignSelf: 'center',
    backgroundColor: Colors.brandSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
    textAlign: 'center',
    marginTop: 14,
  },

  place: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 6,
  },
  bio: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 12,
    paddingHorizontal: 28,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 24,
  },
  tag: {
    backgroundColor: Colors.warmTint,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  tagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  mutuals: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 24,
  },
  mutualStack: { flexDirection: 'row' },
  mutualFace: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: Colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
  mutualFaceOverlap: { marginLeft: -7 },
  mutualImg: { width: '100%', height: '100%' },
  mutualInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.micro,
    color: Colors.terracotta,
  },
  mutualText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    flexShrink: 1,
  },
  // New-here marker: gold tint as a warm background (not gold text), status-
  // neutral, invites welcome. Fades by data once they have history.
  newHere: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    backgroundColor: Colors.goldenAmberTint15,
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'center',
    marginTop: 16,
  },
  trust: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 24,
  },

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
  },
  actionDisabled: { opacity: 0.55 },
  actionPressed: { opacity: 0.8 },
  actionPrimary: { backgroundColor: Colors.terracotta },
  actionPrimaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  // Gold = the low-pressure "warm nudge" (documented gold-button exception in
  // CLAUDE.md), in deliberate contrast to the terracotta "do this now".
  actionGold: { backgroundColor: Colors.goldAccent },
  actionGoldText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  keepLink: { alignSelf: 'center', marginTop: 16, paddingVertical: 4 },
  keepLinkText: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodyLG,
    color: Colors.secondary,
  },

  section: { marginTop: 28 },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  planRowPressed: { backgroundColor: Colors.warmTint },
  dateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.terracotta,
  },
  planText: { flex: 1, minWidth: 0 },
  planTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  planMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  pastDate: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    width: 92,
  },
  pastTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  moreCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    paddingHorizontal: 20,
    marginTop: 8,
  },

  stats: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 32,
  },

  emptyBlock: { alignItems: 'center', marginTop: 36, paddingHorizontal: 32 },
  emptyHeadline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.secondary,
    textAlign: 'center',
  },
});


function profileAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
  center: { ...baseStyles.center, padding: 24 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 12, paddingBottom: 40 },
  identityRow: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingHorizontal: 20 },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  avatar: { ...baseStyles.avatar, width: 80, height: 80, borderRadius: 40, backgroundColor: AfterglowColors.avatar, alignSelf: 'auto' },
  avatarInitial: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  name: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
  handle: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  place: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingHorizontal: 20, marginTop: 14 },
  bio: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink, paddingHorizontal: 20, marginTop: 12 },
  tags: { ...baseStyles.tags, justifyContent: 'flex-start', paddingHorizontal: 20, gap: 6 },
  tag: { ...baseStyles.tag, borderRadius: 4, backgroundColor: AfterglowColors.paper },
  tagText: { ...AfterglowType.caption, fontFamily: fonts.medium, color: AfterglowColors.muted },
  mutuals: { ...baseStyles.mutuals, justifyContent: 'flex-start', paddingHorizontal: 20, marginTop: 16 },
  mutualFace: { ...baseStyles.mutualFace, width: 28, height: 28, borderRadius: 14, backgroundColor: AfterglowColors.avatar, borderColor: AfterglowColors.paper },
  mutualInitial: { ...AfterglowType.caption, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  mutualText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, flexShrink: 1 },
  newHere: { ...AfterglowType.caption, fontFamily: fonts.medium, color: AfterglowColors.ink, backgroundColor: AfterglowColors.paper, borderRadius: 4, alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 12, paddingHorizontal: 8, paddingVertical: 4 },
  trust: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingHorizontal: 20, marginTop: 10 },
  actions: { ...baseStyles.actions, marginTop: 20 },
  actionBtn: { ...baseStyles.actionBtn, borderRadius: 4, minHeight: 46, paddingHorizontal: 8, paddingVertical: 12 },
  actionGold: { backgroundColor: AfterglowColors.paper, borderWidth: 1, borderColor: AfterglowColors.line },
  actionGoldText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  actionPrimary: { backgroundColor: AfterglowColors.clay },
  actionPrimaryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
  keepLink: { ...baseStyles.keepLink, minHeight: 44, marginTop: 8, paddingHorizontal: 20, justifyContent: 'center' },
  keepLinkText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay },
  section: { marginTop: 24 },
  sectionLabel: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, paddingHorizontal: 20, marginBottom: 8 },
  planRow: { ...baseStyles.planRow, marginHorizontal: 20, paddingHorizontal: 0, paddingVertical: 14, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  planRowPressed: { backgroundColor: AfterglowColors.paper },
  dateDot: { ...baseStyles.dateDot, backgroundColor: AfterglowColors.clay },
  planTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  planMeta: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 3 },
  pastDate: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, width: 88 },
  pastTitle: { ...AfterglowType.title, fontFamily: fonts.medium, color: AfterglowColors.ink, flex: 1, minWidth: 0 },
  moreCount: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingHorizontal: 20, marginTop: 10 },
  stats: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 24, paddingHorizontal: 20 },
  emptyBlock: { marginTop: 24, paddingHorizontal: 20 },
  emptyHeadline: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.muted },
  notFound: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.muted, textAlign: 'center' },
  statusTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textAlign: 'center' },
  statusText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 10 },
  retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  feedback: { ...AfterglowType.body, fontFamily: fonts.regular, color: Colors.errorRed, paddingHorizontal: 20, marginTop: 16 },
}); }
