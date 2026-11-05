import { ScaledText } from '../../ScaledText';
import React, { useState, useMemo, useRef } from 'react';
import { View, TextInput, FlatList, StyleSheet, ActivityIndicator, ScrollView, useWindowDimensions, Pressable, Platform } from 'react-native';
import { Search } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import PersonRow from './PersonRow';
import { usePlanHistoryBacklog } from '../../../hooks/usePlanHistoryBacklog';
import type { PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';
import { usePeoplePathVisit, type PeoplePathAppearance } from './usePeoplePathVisit';

export type PlanHistoryBacklogProps = { userId: string; readScope: NonNullable<Parameters<typeof usePlanHistoryBacklog>[1]>; onPressPerson: (id: string) => void; appearance?: PeoplePathAppearance; operationScope?: PeopleConnectionScope };
/** Existing completed-plan backlog with a local first-name substring filter.
 * It never performs remote name discovery or expands the received people. */
export default function PlanHistoryBacklog({ userId, onPressPerson, appearance, operationScope, readScope }: PlanHistoryBacklogProps) {
  const { fontScale } = useWindowDimensions();
  const [input, setInput] = useState({ userId, value: '' });
  const q = input.userId === userId ? input.value : '', normalized = q.trim().toLowerCase();
  const backlog = usePlanHistoryBacklog(userId, readScope);
  const visit = usePeoplePathVisit(userId, normalized, operationScope);
  const queryRef = useRef(normalized); queryRef.current = normalized;
  const list = (backlog.data ?? []).filter(p => (p.first_name_display ?? '').toLowerCase().includes(normalized));
  const latest = useRef({ data: backlog.data, list, onPressPerson }); latest.current = { data: backlog.data, list, onPressPerson };
  const eligible = (id: string) => latest.current.data?.some(p => p.user_id === id && p.state === 'none') === true &&
    latest.current.list.some(p => p.user_id === id);
  const loading = backlog.isLoading || visit.reading;
  const failed = backlog.isError && !loading;
  const s = useMemo(() => appearance ? { ...styles, ...backlogAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  // Apply the full iOS text scale once to the existing input,
  // without replacing the focused input or its controlled search value.
  const inputType = Platform.OS === 'ios' ? {
    fontSize: (appearance ? AfterglowType.body.fontSize : FontSizes.bodyMD) * fontScale,
    lineHeight: (appearance ? AfterglowType.body.lineHeight : LineHeights.bodyMD) * fontScale,
    minHeight: (appearance ? AfterglowType.body.lineHeight : LineHeights.bodyMD) * fontScale + 12,
  } : undefined;
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  return (
    <View style={s.wrap}>
      <View style={s.searchBox}>
        <Search size={18} color={appearance ? AfterglowColors.muted : Colors.tertiary} />
        <View style={styles.inputWrap}>
        <TextInput value={q} allowFontScaling={Platform.OS === 'ios' ? false : undefined} onChangeText={value => {
          const next = value.trim().toLowerCase();
          if (next !== queryRef.current) { queryRef.current = next; visit.retireQuery(); }
          setInput({ userId, value });
        }} placeholder={Platform.OS === 'ios' ? undefined : "Search people from your plans"} placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
          autoCorrect={false} accessibilityLabel="Search people from your completed plans" style={[s.input, styles.inputField, inputType]} />
        {Platform.OS === 'ios' && !q && <View pointerEvents="none" style={styles.hintWrap} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ScaledText accessible={false} allowFontScaling={false} numberOfLines={1} style={[s.input, inputType, styles.hintText, { color: appearance ? AfterglowColors.muted : Colors.tertiary }]}>Search people</ScaledText>
        </View>}
        </View>
      </View>
      {loading ? <ScrollView style={s.recovery} contentContainerStyle={s.feedback} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><ScaledText style={s.empty}>Loading people from your plans…</ScaledText></ScrollView> : failed ?
        <View style={s.recovery}>
          <ScrollView style={s.recovery} contentContainerStyle={s.feedback} keyboardShouldPersistTaps="handled" accessibilityLiveRegion="polite"><ScaledText style={s.feedbackTitle}>Couldn’t load people from your plans.</ScaledText><ScaledText style={s.empty}>Your search is still here.</ScaledText></ScrollView>
          <Pressable style={[s.retry, s.recoveryRetry]} accessibilityRole="button" accessibilityLabel="Try again to load people from your plans" onPress={() => { void visit.refresh(backlog.refetch); }}>
            <ScaledText numberOfLines={1} style={s.retryText}>Try again</ScaledText>
          </Pressable></View> : (
        <FlatList data={list} keyExtractor={p => p.user_id} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}
          extraData={visit.rows} renderItem={({ item }) => {
            const status = visit.rows[item.user_id];
            const state = status?.phase === 'connected' ? 'connected' : status?.phase === 'requested' || item.state === 'requested' ? 'requested' : 'none';
            return <View>
              <PersonRow name={item.first_name_display} photoUrl={item.profile_photo_url} sharedCount={item.shared_count}
                state={state} isAdding={status?.phase === 'sending'} appearance={appearance}
                onAdd={() => { void visit.add(item.user_id, 'plan_history', () => eligible(item.user_id)); }}
                onPressPerson={() => { if (visit.current() && latest.current.list.some(p => p.user_id === item.user_id)) latest.current.onPressPerson(item.user_id); }} />
              {status?.phase === 'connected' && <ScaledText style={s.rowFeedback} accessibilityLiveRegion="polite">You’re connected.</ScaledText>}
              {status?.phase === 'error' && <View accessibilityLiveRegion="polite"><ScaledText style={s.rowFeedback} accessibilityRole="alert">{status.message}</ScaledText>
                {eligible(item.user_id) && <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel={`Try again to add ${item.first_name_display ?? 'this person'}`} onPress={() => { void visit.add(item.user_id, 'plan_history', () => eligible(item.user_id)); }}>
                  <ScaledText numberOfLines={1} style={s.retryText}>Try again</ScaledText>
                </Pressable>}</View>}
            </View>;
          }} ListEmptyComponent={<View style={s.feedback}><ScaledText style={s.empty}>{normalized ? 'No matches in your past plans. Try another name.' : 'People from completed plans will appear here. Make a plan and meet someone new.'}</ScaledText>
            {!!normalized && <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel="Clear name search" onPress={() => {
              if (!visit.current()) return; queryRef.current = ''; visit.retireQuery(); setInput({ userId, value: '' });
            }}><ScaledText numberOfLines={1} style={s.retryText}>Clear search</ScaledText></Pressable>}
          </View>} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recovery: { flex: 1 },
  recoveryRetry: { flexShrink: 0, marginBottom: 16, paddingVertical: 10 },
  content: { paddingBottom: 24 },
  feedback: { paddingTop: 24, paddingBottom: 24, gap: 8 },
  feedbackTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  rowFeedback: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  retry: { minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: Colors.terracotta, borderRadius: 5, marginTop: 12 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  wrap: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    paddingVertical: 6,
    marginBottom: 8,
  },
  inputWrap: { flex: 1, minWidth: 0 },
  inputField: { flex: 0 },
  hintWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
  hintText: { flex: 0, minHeight: undefined },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  empty: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 32,
  },
});

function backlogAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: AfterglowColors.paper },
    searchBox: { ...styles.searchBox, minHeight: 48, height: undefined, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    input: { flex: 1, minWidth: 0, minHeight: 40, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink },
    empty: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 8 },
    rowFeedback: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
    feedbackTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    retry: { ...styles.retry, borderColor: AfterglowColors.clay, borderRadius: 4 },
    retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  });
}
