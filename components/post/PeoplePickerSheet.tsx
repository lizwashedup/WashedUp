/**
 * PeoplePickerSheet - a plain multiselect over your people, used by the composer's
 * "+ Add from your people" affordance (the pull half of the reactance fix). Unlike
 * AddPeopleSheet this has NO circle and calls no invite RPC: it just returns the
 * picked people so the composer turns them into invite chips. Excludes anyone
 * already a chip on the plan.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, SectionList, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import { usePickerFilter } from '../../hooks/usePickerFilter';
import PeopleSearchBar from '../yours/search/PeopleSearchBar';
import type { YoursGridPerson } from '../../lib/yours/types';
import { buildSmartShortlist } from '../../lib/invites/smartShortlist';

const NO_IDS: ReadonlySet<string> = new Set();
const SUGGESTED_MAX = 5;

export interface PickedPerson {
  user_id: string;
  name: string;
  photo: string | null;
  handle?: string | null;
}

type Appearance = { fonts: AfterglowFontFamilies };
const displayHandle = (handle?: string | null) => handle?.trim().replace(/^@+/, '') || '';

const AVATAR = 44;
const CHECK = 24;

function PickerAvatar({ person, name, styles, appearance }: { person: YoursGridPerson; name: string; styles: Pick<typeof baseStyles | ReturnType<typeof afterglow>, 'avatar' | 'avatarFallback' | 'initial'>; appearance?: Appearance }) {
  const [failed, setFailed] = useState(false);
  return person.profile_photo_url && (!appearance || !failed) ? (
    <Image source={{ uri: person.profile_photo_url }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" onError={appearance ? () => setFailed(true) : undefined}/>
  ) : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.initial}>{name[0]?.toUpperCase() ?? '?'}</Text></View>;
}

function PickRow({ person, selected, onToggle, appearance }: { person: YoursGridPerson; selected: boolean; onToggle: () => void; appearance?: Appearance }) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglow(appearance.fonts) } : baseStyles, [appearance]);
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  const handle = displayHandle(person.handle);
  return (
    <Pressable
      onPress={() => { hapticSelection(); onToggle(); }}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={appearance && handle ? `${name}, @${handle}` : name}
    >
      <PickerAvatar key={JSON.stringify([person.user_id, person.profile_photo_url])} person={person} name={name} styles={styles} appearance={appearance}/>
      {appearance ? <View style={styles.identity}><Text style={styles.name}>{name}</Text>{!!handle && <Text style={styles.handle} numberOfLines={1}>@{handle}</Text>}</View> : <Text style={styles.name} numberOfLines={1}>{name}</Text>}
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Check size={16} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

type Props = {
  visible: boolean;
  excludeIds: string[];
  onClose: () => void;
  onConfirm: (picked: PickedPerson[]) => void;
  appearance?: Appearance;
};

export default function PeoplePickerSheet(props: Props) {
  return props.visible ? <ObservedPeoplePicker {...props} /> : null;
}

function ObservedPeoplePicker(props: Props) {
  const viewer = useObservedUser();
  return <AccountPeoplePicker key={`${viewer.viewerId}:${viewer.epoch}`} {...props} viewer={viewer} />;
}

function AccountPeoplePicker({ viewer, ...props }: Props & { viewer: ReturnType<typeof useObservedUser> }) {
  const userId = !viewer.error && !viewer.isLoading ? viewer.viewerId : undefined;
  const query = useYoursGrid(userId);
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ready = !!userId && query.isSuccess;
  const loading = retrying || viewer.isLoading || (!!userId && (query.isLoading || (query.isFetching && !query.data)));
  const retry = async () => {
    if (!mounted.current || !viewer.isCurrent() || retryRef.current || loading) return;
    retryRef.current = true;
    setRetrying(true);
    try {
      if (!userId || viewer.error) await viewer.retry();
      else await query.refetch();
    } catch {
      // A failed retry stays in the existing error state, without an unhandled
      // promise or a false successful empty list.
    } finally {
      retryRef.current = false;
      if (mounted.current) setRetrying(false);
    }
  };
  return <PeoplePickerContents key={`${viewer.viewerId}:${viewer.epoch}`} {...props}
    people={ready ? query.data : []} loading={loading} error={!loading && !ready} onRetry={() => { void retry(); }}
    isCurrent={() => viewer.isCurrent() && !!userId && ready} />;
}

function PeoplePickerContents({
  visible,
  excludeIds,
  onClose,
  onConfirm,
  people,
  loading,
  error,
  onRetry,
  isCurrent,
  appearance,
}: Props & {
  people: YoursGridPerson[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  isCurrent: () => boolean;
}) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglow(appearance.fonts) } : baseStyles, [appearance]);
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const confirmed = useRef(false);
  const closed = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const pickable = useMemo(() => {
    const present = new Set(excludeIds);
    return people.filter((p) => !present.has(p.user_id));
  }, [people, excludeIds]);
  const selectedCount = pickable.filter(person => selected.has(person.user_id)).length;
  const latest = useRef({ pickable, selected, isCurrent });
  latest.current = { pickable, selected, isCurrent };

  // Suggested = ranked purely by real shared-plan count against people you're
  // already connected to (the same set `pickable` already authorizes — this
  // sheet has no separate opt-in concept to check). matchingCategoryActivityCount
  // and activityRecency aren't computed anywhere yet, so they're passed as 0
  // rather than invented; only sharedActivityCount drives the ranking today.
  // Anyone with zero shared plans is excluded from the section entirely so it
  // never implies a signal that isn't real.
  const suggestedIds = useMemo(() => {
    const allowed = new Set(pickable.map((p) => p.user_id));
    const ranked = buildSmartShortlist(
      pickable.map((p) => ({
        personId: p.user_id,
        sharedActivityCount: p.shared_count,
        matchingCategoryActivityCount: 0,
        activityRecency: 0,
        payload: p,
      })),
      { allowedPersonIds: allowed, blockedPersonIds: NO_IDS, dismissedPersonIds: NO_IDS, alreadyInvitedPersonIds: NO_IDS },
      { sharedActivityCount: 1, matchingCategoryActivityCount: 0, activityRecency: 0 },
    );
    return ranked
      .filter((entry) => entry.candidate.sharedActivityCount > 0)
      .slice(0, SUGGESTED_MAX)
      .map((entry) => entry.candidate.personId);
  }, [pickable]);

  // Search appears only past the threshold; selected people stay visible even
  // when they fall outside the current query.
  const { query, setQuery, showSearch, filtered } = usePickerFilter(
    pickable,
    (p) => selected.has(p.user_id),
  );

  // Once the search field is hidden, its old local query must not silently
  // hide people in a smaller refreshed list.
  const matches = showSearch ? filtered : pickable;

  // The Suggested group only makes sense against the unfiltered list — once
  // someone is actively searching, show one flat, unlabeled set of matches.
  const sections = useMemo(() => {
    if (query.trim() || suggestedIds.length === 0) {
      return [{ title: null as string | null, data: matches }];
    }
    const suggestedSet = new Set(suggestedIds);
    const byId = new Map(matches.map((p) => [p.user_id, p]));
    const suggested = suggestedIds.map((id) => byId.get(id)).filter((p): p is YoursGridPerson => !!p);
    const rest = matches.filter((p) => !suggestedSet.has(p.user_id));
    const out: { title: string | null; data: YoursGridPerson[] }[] = [];
    if (suggested.length > 0) out.push({ title: COPY.peoplePickerSuggestedLabel, data: suggested });
    out.push({ title: null, data: rest });
    return out;
  }, [matches, suggestedIds, query]);

  const toggle = (id: string) => {
    if (!mounted.current || closed.current || !latest.current.isCurrent() || !latest.current.pickable.some(person => person.user_id === id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const close = () => {
    if (!mounted.current || closed.current) return;
    closed.current = true; setSelected(new Set()); onClose();
  };

  const confirm = () => {
    if (!mounted.current || closed.current || !latest.current.isCurrent() || confirmed.current) return;
    const picked: PickedPerson[] = latest.current.pickable
      .filter((p) => latest.current.selected.has(p.user_id))
      .map((p) => ({
        user_id: p.user_id,
        name: p.first_name_display?.trim() || p.handle?.trim() || 'Someone',
        photo: p.profile_photo_url,
        ...(displayHandle(p.handle) ? { handle: displayHandle(p.handle) } : {}),
      }));
    if (picked.length === 0) return;
    confirmed.current = true; closed.current = true;
    setSelected(new Set());
    onConfirm(picked);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={close} accessibilityLabel={COPY.circlePlusCancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{COPY.peoplePickerTitle}</Text>
            <Pressable onPress={close} style={appearance ? styles.close : undefined} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel}>
              <X size={22} color={appearance ? AfterglowColors.muted : Colors.secondary} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta} /></View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle} accessibilityRole="alert">Your people couldn’t load.</Text>
              <Pressable style={styles.retry} onPress={() => { if (mounted.current && !closed.current) onRetry(); }} accessibilityRole="button" accessibilityLabel="Retry loading your people">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : pickable.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>{appearance && people.length === 0 ? 'Your people will appear here.' : COPY.peoplePickerEmptyTitle}</Text>
              <Text style={styles.emptySub}>{appearance && people.length === 0 ? 'Connect with someone in Yours, then invite them to a plan.' : COPY.peoplePickerEmptySub}</Text>
            </View>
          ) : (
            <>
              {showSearch && <PeopleSearchBar value={query} onChange={(value) => { if (mounted.current && !closed.current && latest.current.isCurrent()) setQuery(value); }} appearance={appearance} />}
              <SectionList
                sections={sections}
                keyExtractor={(p) => p.user_id}
                renderItem={({ item }) => (
                  <PickRow person={item} selected={selected.has(item.user_id)} onToggle={() => toggle(item.user_id)} appearance={appearance} />
                )}
                renderSectionHeader={({ section }) =>
                  section.title ? <Text style={styles.sectionLabel}>{section.title}</Text> : null
                }
                ListEmptyComponent={appearance ? <View style={styles.center}><Text style={styles.emptyTitle}>No matches</Text><Text style={styles.emptySub}>Try another name or handle.</Text></View> : undefined}
                stickySectionHeadersEnabled={false}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            </>
          )}

          {pickable.length > 0 && (
            <Pressable
              onPress={confirm}
              disabled={selectedCount === 0}
              style={[styles.cta, selectedCount === 0 && styles.ctaDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedCount === 0 }}
              aria-disabled={selectedCount === 0}
              accessibilityLabel={appearance && selectedCount === 0 ? 'Add people' : COPY.peoplePickerConfirm(selectedCount)}
            >
              <Text style={styles.ctaLabel} numberOfLines={1}>{appearance && selectedCount === 0 ? 'Add people' : COPY.peoplePickerConfirm(selectedCount)}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, minWidth: 0 },
  handle: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
  backdropTap: { flex: 1 },
  sheet: { backgroundColor: Colors.parchment, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, maxHeight: '80%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  center: { paddingVertical: 48, paddingHorizontal: 40, alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, marginTop: 12 },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  emptyTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary, textAlign: 'center', marginTop: 8 },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 12 },
  sectionLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 14 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: Colors.inputBg },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  name: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  check: { width: CHECK, height: CHECK, borderRadius: CHECK / 2, borderWidth: 1.5, borderColor: Colors.borderWarm, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  cta: { backgroundColor: Colors.terracotta, borderRadius: 999, marginHorizontal: 20, marginTop: 8, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  sheet: { ...baseStyles.sheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingTop: 12 },
  headerRow: { ...baseStyles.headerRow, marginBottom: 4 },
  title: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, flex: 1 },
  emptyTitle: { ...baseStyles.emptyTitle, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  emptySub: { ...baseStyles.emptySub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  sectionLabel: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  row: { ...baseStyles.row, minHeight: 72, paddingVertical: 12, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  avatar: { ...baseStyles.avatar, backgroundColor: AfterglowColors.avatar },
  avatarFallback: { ...baseStyles.avatarFallback, backgroundColor: AfterglowColors.avatar },
  initial: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.muted },
  name: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  handle: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  check: { ...baseStyles.check, borderRadius: 4, borderColor: AfterglowColors.line },
  checkOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
  cta: { ...baseStyles.cta, minHeight: 48, backgroundColor: AfterglowColors.clay, borderRadius: 4, paddingVertical: 12 },
  ctaLabel: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
}); }
