import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator, Text, KeyboardAvoidingView, Platform, Pressable, ScrollView } from 'react-native';
import { AtSign } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import PersonRow from './PersonRow';
import { usePeopleSearch } from '../../../hooks/usePeopleSearch';
import type { PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';
import { usePeoplePathVisit, type PeoplePathAppearance } from './usePeoplePathVisit';

export type HandleLookupViewProps = { userId: string; onPressPerson: (id: string) => void; appearance?: PeoplePathAppearance; operationScope?: PeopleConnectionScope };
const normalizedHandle = (value: string) => value.trim().replace(/^@+/, '').toLowerCase();
/** Exact handles only. Previous debounced results cannot become current rows,
 * actions, or no-match feedback while a different query is settling. */
export default function HandleLookupView({ userId, onPressPerson, appearance, operationScope }: HandleLookupViewProps) {
  const [input, setInput] = useState({ userId, value: '' });
  const q = input.userId === userId ? input.value : '', normalized = normalizedHandle(q);
  const lookup = usePeopleSearch(userId, q);
  const visit = usePeoplePathVisit(userId, normalized, operationScope);
  const [settled, setSettled] = useState<string | null>(null);
  const queryKey = `${userId}:${normalized}`;
  useEffect(() => { const timer = setTimeout(() => setSettled(queryKey), 300); return () => clearTimeout(timer); }, [queryKey]);
  const queryRef = useRef(normalized); queryRef.current = normalized;
  const enabled = !!userId && normalized.length >= 2;
  const loading = enabled && (settled !== queryKey || lookup.isFetching || lookup.isPending || visit.reading);
  const failed = enabled && settled === queryKey && lookup.isError && !loading;
  const match = enabled && settled === queryKey && !loading && !failed ? lookup.data?.find(person =>
    person.handle?.replace(/^@+/, '').toLowerCase() === normalized && person.user_id !== userId) : undefined;
  const latest = useRef({ match, onPressPerson }); latest.current = { match, onPressPerson };
  const eligible = (id: string) => !!latest.current.match && latest.current.match.user_id === id &&
    (latest.current.match.connection_state === 'none' || latest.current.match.connection_state === 'incoming');
  const status = match ? visit.rows[match.user_id] : undefined;
  const state = match?.connection_state === 'connected' || status?.phase === 'connected' ? 'connected' :
    match?.connection_state === 'requested' || status?.phase === 'requested' ? 'requested' : 'none';
  const s = useMemo(() => appearance ? { ...styles, ...lookupAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inputBox}>
        <AtSign size={18} color={appearance ? AfterglowColors.muted : Colors.tertiary} />
        <TextInput value={q} onChangeText={value => {
          const next = normalizedHandle(value);
          if (next !== queryRef.current) { queryRef.current = next; visit.retireQuery(); }
          setInput({ userId, value });
        }} placeholder="Enter an exact handle" placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
          autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="search"
          accessibilityLabel="Find someone by their exact handle" style={s.input} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        {loading ? <View style={s.feedback} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><Text style={s.hint}>Looking up handle…</Text></View> : failed ?
          <View style={s.feedback} accessibilityLiveRegion="polite"><Text style={s.feedbackTitle}>Couldn’t look up that handle.</Text><Text style={s.hint}>Your search is still here.</Text>
            <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel="Try again to look up this handle" onPress={() => { void visit.refresh(lookup.refetch); }}>
              <Text style={s.retryText} numberOfLines={1}>Try again</Text>
            </Pressable></View> : match ? <>
          {match.connection_state === 'incoming' && state === 'none' && <Text style={s.hint}>This person has asked to connect. Add them back when you’re ready.</Text>}
          <PersonRow name={match.first_name_display} photoUrl={match.profile_photo_url} sharedCount={match.shared_count}
            state={state} isAdding={status?.phase === 'sending'} appearance={appearance}
            onAdd={() => { void visit.add(match.user_id, 'handle_lookup', () => eligible(match.user_id)); }}
            onPressPerson={() => { if (visit.current() && latest.current.match?.user_id === match.user_id) latest.current.onPressPerson(match.user_id); }} />
          {status?.phase === 'connected' && <Text style={s.hint} accessibilityLiveRegion="polite">You’re connected.</Text>}
          {status?.phase === 'error' && <View accessibilityLiveRegion="polite"><Text style={s.hint} accessibilityRole="alert">{status.message}</Text>
            {eligible(match.user_id) && <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel={`Try again to add ${match.first_name_display ?? 'this person'}`} onPress={() => { void visit.add(match.user_id, 'handle_lookup', () => eligible(match.user_id)); }}>
              <Text style={s.retryText} numberOfLines={1}>Try again</Text>
            </Pressable>}</View>}
        </> : <Text style={s.hint}>{enabled && settled === queryKey ? 'No one with that handle. Check the spelling and try again.' : 'Enter a full handle to find someone you know.'}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  feedback: { paddingTop: 24, gap: 8 },
  feedbackTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  retry: { minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: Colors.terracotta, borderRadius: 5, marginTop: 12 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  wrap: { flex: 1 },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});

function lookupAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: AfterglowColors.paper },
    inputBox: { ...styles.inputBox, minHeight: 48, height: undefined, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    input: { flex: 1, minWidth: 0, minHeight: 40, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink },
    hint: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 12 },
    feedbackTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    retry: { ...styles.retry, borderColor: AfterglowColors.clay, borderRadius: 4 },
    retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  });
}
