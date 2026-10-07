/**
 * AddPeopleSheet - pick from your people and add them to a circle.
 *
 * Reused by the circle header "+" menu, the View-circle detail page, and (next
 * chunk) growing a 2-person DM into a circle. Lists the people you already have
 * (the existing get_yours_grid source) minus current members, then
 * invite_to_circle on confirm. Low-pressure copy: people "join the moment you
 * add them" (no request/accept round-trip - these are already your people).
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useObservedUser, type ObservedUser } from '../../hooks/useObservedUser';
import { usePickerFilter } from '../../hooks/usePickerFilter';
import { useInviteToCircle, isObsoleteCircleInvite, ObsoleteCircleInviteError, type InviteToCircleScope } from '../../hooks/useInviteToCircle';
import { supabase } from '../../lib/supabase';
import { yoursKeys } from '../../lib/yours/keys';
import { assertRpcShape, YOURS_GRID_KEYS } from '../../lib/yours/shapeGuard';
import PeopleSearchBar from '../yours/search/PeopleSearchBar';
import type { YoursGridPerson } from '../../lib/yours/types';

const AVATAR = 44;
const CHECK = 24;
const EMPTY_PEOPLE: YoursGridPerson[] = [];
let nextAddPeopleVisit = 0;
type Appearance = { fonts: AfterglowFontFamilies };

function PersonPhoto({ person, name, appearance }: { person: YoursGridPerson; name: string; appearance?: Appearance }) {
  const [failed, setFailed] = useState(false), live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const s = useMemo(() => appearance ? { ...styles, ...sheetAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return person.profile_photo_url && !failed ? (
    <Image source={{ uri: person.profile_photo_url }} style={s.avatar}
      contentFit="cover" accessible={false} accessibilityIgnoresInvertColors
      recyclingKey={`${person.user_id}:${person.profile_photo_url}`}
      onError={() => { if (live.current) setFailed(true); }} />
  ) : (
    <View style={[s.avatar, s.avatarFallback]}>
      <Text style={s.initial} accessible={false}>{Array.from(name)[0]?.toUpperCase() ?? '?'}</Text>
    </View>
  );
}

function PickRow({
  person,
  selected,
  onToggle,
  disabled,
  appearance,
}: {
  person: YoursGridPerson;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
  appearance?: Appearance;
}) {
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  const handleValue = person.handle?.trim().replace(/^@+/, '');
  const handle = handleValue ? `@${handleValue}` : null;
  const s = useMemo(() => appearance ? { ...styles, ...sheetAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        hapticSelection();
        onToggle();
      }}
      style={[s.row, appearance && selected && s.selectedRow]}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      accessibilityLabel={handle ? `${name}, ${handle}` : name}
    >
      <PersonPhoto key={JSON.stringify([person.user_id, person.profile_photo_url])} person={person} name={name} appearance={appearance} />
      <View style={s.identity}>
        <Text style={s.name} numberOfLines={appearance ? undefined : 1} accessible={false}>{name}</Text>
        {handle ? <Text style={s.handle} numberOfLines={1} accessible={false}>{handle}</Text> : null}
      </View>
      <View style={[s.check, selected && s.checkOn]}>
        {selected && <Check size={16} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

export interface AddPeopleSheetProps {
  visible: boolean;
  circleId: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded?: () => void;
  scope?: InviteToCircleScope | null;
  appearance?: Appearance;
}

export default function AddPeopleSheet(props: AddPeopleSheetProps) {
  // A closed sheet owns no requests, selections or pending callbacks.
  return props.visible ? <OpenAddPeopleSheet key={props.circleId} {...props} /> : null;
}

function OpenAddPeopleSheet(props: AddPeopleSheetProps) {
  const viewer = useObservedUser();
  const visitId = useMemo(() => ++nextAddPeopleVisit, [props.circleId, viewer.viewerId, viewer.epoch, props.scope]);
  return <AddPeopleVisit key={visitId} {...props} viewer={viewer} visitId={visitId} />;
}

function AddPeopleVisit({
  visible,
  circleId,
  existingMemberIds,
  onClose,
  onAdded,
  scope,
  appearance,
  viewer,
  visitId,
}: AddPeopleSheetProps & { viewer: ObservedUser; visitId: number }) {
  const insets = useSafeAreaInsets();
  const s = useMemo(() => appearance ? { ...styles, ...sheetAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const userId = viewer.viewerId;
  const mounted = useRef(false);
  const retired = useRef(false);
  const pending = useRef<object | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  const identityReady = !!userId && !viewer.error && !viewer.isLoading && viewer.isCurrent() && scope !== null &&
    (!scope || (scope.userId === userId && scope.isCurrent()));
  const isCurrent = useCallback(() => mounted.current && !retired.current && viewer.isCurrent() && !!userId &&
    scope !== null && (!scope || (scope.userId === userId && scope.isCurrent())), [viewer.isCurrent, userId, scope]);
  const operationScope = useMemo(() => ({ userId: userId ?? '', isCurrent }), [userId, isCurrent]);
  const peopleQuery = useQuery({
    // Keep existing grid prefix invalidation, without reusing another sheet or
    // account visit's in-flight/cached result (including A -> B -> A).
    queryKey: [...yoursKeys.grid(userId ?? ''), 'circle-add', circleId, viewer.epoch, visitId],
    enabled: identityReady,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<YoursGridPerson[]> => {
      if (!isCurrent() || signal.aborted) throw new ObsoleteCircleInviteError();
      const { data, error } = await supabase.rpc('get_yours_grid', { p_user_id: userId });
      if (!isCurrent() || signal.aborted) throw new ObsoleteCircleInviteError();
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Could not confirm your people.');
      return assertRpcShape<YoursGridPerson>(data, YOURS_GRID_KEYS, 'get_yours_grid');
    },
  });
  const peopleReady = identityReady && peopleQuery.isSuccess && !peopleQuery.isFetching && !peopleQuery.error;
  const people = peopleReady ? peopleQuery.data : EMPTY_PEOPLE;
  const invite = useInviteToCircle(circleId, userId, operationScope);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ctaPressed, setCtaPressed] = useState(false);

  // Only people not already in the circle can be added.
  const addable = useMemo(() => {
    const present = new Set(existingMemberIds);
    return people.filter((p) => p.user_id !== userId && !present.has(p.user_id));
  }, [people, existingMemberIds, userId]);
  const addableIds = useMemo(() => new Set(addable.map(person => person.user_id)), [addable]);
  const effectiveSelected = useMemo(() => new Set([...selected].filter(id => addableIds.has(id))), [selected, addableIds]);
  const allowance = useRef({ ready: false, ids: new Set<string>(), selected: new Set<string>() });
  useLayoutEffect(() => {
    allowance.current = { ready: peopleReady, ids: addableIds, selected: effectiveSelected };
    if (peopleReady) setSelected(previous => [...previous].every(id => addableIds.has(id)) ? previous : new Set([...previous].filter(id => addableIds.has(id))));
  }, [peopleReady, addableIds, effectiveSelected]);

  // Search appears only past the threshold; selected people stay visible.
  const { query, setQuery, showSearch, filtered } = usePickerFilter(
    addable,
    (p) => effectiveSelected.has(p.user_id),
  );
  // A hidden search field must not keep hiding people after a member update
  // takes this picker below the existing search threshold.
  const visiblePeople = showSearch ? filtered : addable;

  const toggle = (id: string) => {
    if (!isCurrent() || pending.current || !allowance.current.ready || !allowance.current.ids.has(id)) return;
    setAddError(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    if (!mounted.current || retired.current) return;
    // A slow network must not trap someone in this sheet. Closing retires the
    // UI attempt; a dispatched server add may still finish independently.
    retired.current = true;
    setSelected(new Set());
    onClose();
  };

  const confirm = async () => {
    const current = allowance.current;
    if (!isCurrent() || !current.ready || current.selected.size === 0 || pending.current) return;
    const attempt = {}; pending.current = attempt; setSubmitting(true); setAddError(false);
    try {
      await invite.mutateAsync([...current.selected]);
      if (isCurrent() && pending.current === attempt) {
        setSelected(new Set());
        onAdded?.();
        if (isCurrent()) { retired.current = true; onClose(); }
      }
    } catch (error) {
      if (isCurrent() && pending.current === attempt && !isObsoleteCircleInvite(error)) {
        if (appearance) setAddError(true);
        else Alert.alert(COPY.circleAddError);
      }
    } finally {
      if (pending.current === attempt) { pending.current = null; if (mounted.current) setSubmitting(false); }
    }
  };

  const retry = async () => {
    if (!mounted.current || retired.current || pending.current) return;
    if (!userId || viewer.error) { await viewer.retry(); return; }
    if (isCurrent()) await peopleQuery.refetch();
  };
  const loading = viewer.isLoading || (identityReady && peopleQuery.isFetching);
  const unavailable = !identityReady || !!peopleQuery.error;
  const retiredContext = !viewer.isLoading && !viewer.error && !!userId &&
    (!viewer.isCurrent() || scope === null || (!!scope && (scope.userId !== userId || !scope.isCurrent())));
  const count = effectiveSelected.size;
  const actionLabel = submitting && appearance ? `Adding ${count} ${count === 1 ? 'person' : 'people'}…` :
    appearance && addError ? 'Try again' : appearance && count === 0 ? 'Add people' : COPY.circleAddConfirm(count);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={s.backdrop}>
        <Pressable style={s.backdropTap} onPress={close} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.header}>
            <Text style={s.title} accessibilityRole="header">{COPY.circleAddTitle}</Text>
            <Pressable onPress={close} style={appearance ? s.close : undefined} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel}>
              <X size={22} color={appearance ? AfterglowColors.muted : Colors.secondary} />
            </Pressable>
          </View>
          <Text style={s.sub}>{appearance ? 'Choose from your people. Adding them puts them straight in this circle.' : COPY.circleAddSub}</Text>

          {loading ? (
            <View style={s.center}>
              <ActivityIndicator color={accent} />
              {appearance && <Text style={s.emptySub} accessibilityLiveRegion="polite">Loading your people…</Text>}
            </View>
          ) : unavailable ? (
            <View style={s.center}>
              <Text style={s.emptyTitle} accessibilityRole="alert">{appearance && retiredContext ? 'This circle isn’t available.' : 'Couldn’t load your people.'}</Text>
              <Text style={s.emptySub}>{appearance && retiredContext ? 'Close this sheet and open the circle again.' : 'Try again to check who you can add.'}</Text>
              <Pressable onPress={appearance && retiredContext ? close : retry} style={s.retry} accessibilityRole="button"
                accessibilityLabel={appearance && retiredContext ? 'Close' : appearance ? 'Try again to load your people' : 'Retry loading your people'}>
                <Text style={s.retryText} numberOfLines={1}>{appearance && retiredContext ? 'Close' : 'Try again'}</Text>
              </Pressable>
            </View>
          ) : addable.length === 0 ? (
            <View style={s.center}>
              <Text style={s.emptyTitle}>{appearance ? people.some(person => person.user_id !== userId) ? 'Everyone’s already here.' : 'Bring your people along.' : COPY.circleAddEmptyTitle}</Text>
              <Text style={s.emptySub}>{appearance ? people.some(person => person.user_id !== userId) ? 'Your people are already in this circle.' : 'Connect with people in Yours, then add them to this circle.' : COPY.circleAddEmptySub}</Text>
              {appearance && <Pressable style={s.retry} onPress={close} accessibilityRole="button" accessibilityLabel="Done"><Text style={s.retryText} numberOfLines={1}>Done</Text></Pressable>}
            </View>
          ) : (
            <>
              {showSearch && <PeopleSearchBar appearance={appearance} value={query} onChange={value => { if (isCurrent() && !pending.current) setQuery(value); }} />}
              <FlatList
                data={visiblePeople}
                keyExtractor={(p) => p.user_id}
                renderItem={({ item }) => (
                  <PickRow
                    person={item}
                    selected={effectiveSelected.has(item.user_id)}
                    disabled={submitting}
                    onToggle={() => toggle(item.user_id)}
                    appearance={appearance}
                  />
                )}
                style={s.list}
                contentContainerStyle={s.listContent}
                ListEmptyComponent={appearance ? <View style={s.center}>
                  <Text style={s.emptyTitle}>No matches in your people.</Text>
                  <Text style={s.emptySub}>Try another name or handle.</Text>
                  <Pressable style={s.retry} onPress={() => { if (isCurrent() && !pending.current) setQuery(''); }} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Text style={s.retryText} numberOfLines={1}>Clear search</Text>
                  </Pressable>
                </View> : null}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            </>
          )}

          {addable.length > 0 && (
            <View style={appearance ? s.footer : undefined}>
            {appearance && addError && <Text style={s.failure} accessibilityRole="alert" accessibilityLiveRegion="polite">Couldn’t confirm the add. Your selection is still here.</Text>}
            <View style={appearance ? s.footerActions : undefined}>
            {appearance && <Text style={s.selection} accessibilityLiveRegion="polite">{count} selected</Text>}
            <Pressable
              onPress={confirm}
              onPressIn={() => { if (isCurrent()) setCtaPressed(true); }}
              onPressOut={() => { if (isCurrent()) setCtaPressed(false); }}
              disabled={effectiveSelected.size === 0 || submitting}
              style={[
                s.cta,
                (effectiveSelected.size === 0 || submitting) && s.ctaDisabled,
                ctaPressed && s.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: effectiveSelected.size === 0 || submitting, busy: submitting }}
              accessibilityLabel={appearance && addError ? `Try again to add ${count} ${count === 1 ? 'person' : 'people'}` : actionLabel}
            >
              {submitting ? (
                <View style={s.pendingAction}><ActivityIndicator color={appearance ? AfterglowColors.white : Colors.white} />
                  {appearance && <Text style={s.ctaLabel} numberOfLines={1}>Adding…</Text>}
                </View>
              ) : (
                <Text style={s.ctaLabel} numberOfLines={1}>{actionLabel}</Text>
              )}
            </Pressable>
            </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  close: {}, selectedRow: {}, footer: {}, footerActions: {}, selection: {}, failure: {},
  pendingAction: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  center: { paddingVertical: 48, paddingHorizontal: 40, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 8,
  },
  retry: { minHeight: 44, justifyContent: 'center', marginTop: 12 },
  retryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 14 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: Colors.inputBg },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  handle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  name: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: CHECK / 2,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  cta: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});

function sheetAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  sheet: { ...styles.sheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingTop: 12 },
  title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, flex: 1, minWidth: 0 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  sub: { ...styles.sub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingTop: 2, paddingBottom: 14 },
  center: { paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textAlign: 'center' },
  emptySub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center', marginTop: 8 },
  retry: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', marginTop: 8 },
  retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12, minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  selectedRow: { backgroundColor: AfterglowColors.unread },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: AfterglowColors.avatar, opacity: 1 },
  avatarFallback: { ...styles.avatarFallback, backgroundColor: AfterglowColors.avatar },
  initial: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.muted },
  handle: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  name: { minWidth: 0, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  check: { ...styles.check, borderRadius: 4, borderColor: AfterglowColors.line },
  checkOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
  listContent: { paddingBottom: 4 },
  footer: { paddingTop: 12, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.line, gap: 10 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selection: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted, flexShrink: 1 },
  failure: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink },
  cta: { backgroundColor: AfterglowColors.clay, borderRadius: 4, paddingVertical: 12, paddingHorizontal: 12,
    flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
}); }
