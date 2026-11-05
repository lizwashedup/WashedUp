import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight } from 'lucide-react-native';
import { ScaledText as Text } from '../ScaledText';
import { PageAction } from './pages/PageFrame';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { useMemberInviteSearch } from '../../hooks/useMemberInviteSearch';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import type { ProfileSearchResult } from '../../lib/coCreatorInvites';
import { loadMemberInvitePeople, type MemberInvitePerson } from '../../lib/memberInvitePeople';

type Props = { communityId: string; scope: CreatorPageScope; disabled: boolean; onSelect: (person: ProfileSearchResult) => void };

/** A closed picker owns no requests or private People results. Selection alone never creates a link. */
export function MemberInviteRecipientPicker(props: Props) {
  const [mode, setMode] = useState<'people' | 'handle'>('people');
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  return <View style={s.section}>
    <Text style={s.label}>Who would you like to invite?</Text>
    <View style={s.tabs} accessibilityRole="tablist">
      {(['people', 'handle'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
        accessibilityLabel={value === 'people' ? 'Your people' : 'By handle'}
        accessibilityState={{ selected: mode === value, disabled: props.disabled }} disabled={props.disabled}
        onPress={() => { if (!props.disabled && props.scope.isCurrent()) { Keyboard.dismiss(); setMode(value); } }}
        style={[s.tab, mode === value && s.activeTab]}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[s.tabLabel, mode === value && s.activeLabel]}>{value === 'people' ? 'Your people' : 'By handle'}</Text>
      </Pressable>)}
    </View>
    {mode === 'people' ? <YourPeople {...props} /> : <ByHandle {...props} />}
  </View>;
}

function usePickerScope(parent: CreatorPageScope): CreatorPageScope {
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useMemo(() => ({ userId: parent.userId, isCurrent: () => mounted.current && parent.isCurrent() }), [parent]);
}

function useInputType() {
  const { fontScale } = useWindowDimensions();
  return Platform.OS === 'ios' ? { fontSize: FontSizes.bodyMD * fontScale, lineHeight: LineHeights.bodyMD * fontScale } : undefined;
}

function YourPeople({ communityId, scope: parent, disabled, onSelect }: Props) {
  const scope = usePickerScope(parent);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  const inputType = useInputType();
  const load = useCallback((current: CreatorPageScope) => loadMemberInvitePeople(communityId, current), [communityId]);
  const people = useCreatorPageRead(scope, load);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const usable = !people.loading && !people.error && scope.isCurrent();
  // Do not show cached private handles through a failed membership/People refresh.
  const rows = usable ? people.data ?? [] : [];
  const term = query.trim().toLocaleLowerCase().replace(/^@+/, '');
  const filtered = rows.filter(person => !term || person.name.toLocaleLowerCase().includes(term)
    || person.handle?.toLocaleLowerCase().replace(/^@+/, '').includes(term));
  return <View style={s.section}>
    <Text style={s.meta}>People you’ve connected with on WashedUp.</Text>
    <TextInput value={query} onChangeText={value => { setQuery(value); setLimit(10); }} placeholder="Search by name or handle"
      accessibilityLabel="Search your people" autoCapitalize="none" autoCorrect={false} editable={!disabled}
      style={[s.input, inputType]} allowFontScaling={Platform.OS === 'ios' ? false : undefined}
      placeholderTextColor={Colors.inkSoft} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
    {people.loading && <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading your people" />}
    {people.error && <><Text style={s.meta} accessibilityRole="alert">Couldn’t load your people and their community membership.</Text>
      <PageAction quiet compact title="Try again" onPress={() => void people.refresh().catch(() => undefined)} /></>}
    {usable && !rows.length && <Text style={s.meta}>People you connect with will appear here. To invite someone else, choose By handle.</Text>}
    {usable && !!rows.length && !filtered.length && <Text style={s.meta}>No match in your people. Try another name, or choose By handle.</Text>}
    {filtered.slice(0, limit).map(person => <Recipient key={person.id} person={person} disabled={disabled || !!person.membership}
      subtitle={membershipLabel(person.membership) ?? (person.handle ? `@${person.handle.replace(/^@+/, '')}` : undefined)}
      onPress={() => { if (!disabled && usable && !person.membership && scope.isCurrent()) { Keyboard.dismiss(); onSelect(person); } }} />)}
    {filtered.length > limit && <PageAction quiet compact title="Show more" disabled={disabled} onPress={() => setLimit(value => value + 10)} />}
  </View>;
}

function ByHandle({ scope: parent, disabled, onSelect }: Props) {
  const scope = usePickerScope(parent);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  const inputType = useInputType();
  const [query, setQuery] = useState('');
  const search = useMemberInviteSearch(query, scope, !disabled);
  return <View style={s.section}>
    <TextInput value={query} onChangeText={setQuery} editable={!disabled} placeholder="Enter their handle" accessibilityLabel="Search by handle"
      autoCapitalize="none" autoCorrect={false} style={[s.input, inputType]} allowFontScaling={Platform.OS === 'ios' ? false : undefined}
      placeholderTextColor={Colors.inkSoft} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
    <Text style={s.meta}>Use a handle they’ve shared with you.</Text>
    {search.loading && <ActivityIndicator accessibilityLabel="Searching profiles" color={Colors.terracotta} />}
    {search.error && <><Text accessibilityRole="alert" style={s.meta}>Couldn’t search right now.</Text><PageAction quiet compact title="Try again" onPress={search.retry} /></>}
    {search.results.map(person => <Recipient key={person.id} person={person} disabled={disabled}
      onPress={() => { if (!disabled && scope.isCurrent()) { Keyboard.dismiss(); onSelect(person); } }} />)}
    {query.trim().length >= 2 && !search.loading && !search.error && !search.results.length && <Text style={s.meta}>No match. Check their handle and try again.</Text>}
  </View>;
}

function membershipLabel(status: MemberInvitePerson['membership']) {
  return status === 'active' ? 'Already a member' : status === 'pending' ? 'Join request pending' : status === 'banned' ? 'Unavailable to invite' : null;
}

function Recipient({ person, subtitle, disabled, onPress }: { person: ProfileSearchResult; subtitle?: string; disabled: boolean; onPress: () => void }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const s = useMemo(() => styles(fonts), [fonts]);
  const [photoFailed, setPhotoFailed] = useState(false);
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={`Select ${person.name}`} accessibilityHint={subtitle}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.person, pressed && s.pressed]}>
    {person.photo && !photoFailed ? <Image source={{ uri: person.photo }} style={s.avatar} contentFit="cover" accessible={false} onError={() => setPhotoFailed(true)} />
      : <View style={[s.avatar, s.fallback]}><Text style={s.label} accessible={false}>{Array.from(person.name.trim())[0]?.toUpperCase() ?? '?'}</Text></View>}
    <View style={s.personText}><Text style={s.label}>{person.name}</Text>{subtitle && <Text style={s.meta}>{subtitle}</Text>}</View>
    {!disabled && <ChevronRight size={18} color={Colors.secondary} accessible={false} />}
  </Pressable>;
}

const styles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  section: { gap: 12 },
  label: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  meta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  input: { backgroundColor: Colors.inputBg, borderRadius: 8, minHeight: 48, padding: 12, fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: Colors.border },
  activeTab: { borderBottomColor: Colors.terracotta },
  tabLabel: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  activeLabel: { color: Colors.darkWarm },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
  personText: { flex: 1, minWidth: 0, gap: 3 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  pressed: { opacity: 0.7 },
});
