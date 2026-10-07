import React, { useState, useMemo, useRef } from 'react';
import { View, TextInput, FlatList, StyleSheet, ActivityIndicator, Text, Pressable } from 'react-native';
import { Search } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import PersonRow from './PersonRow';
import { usePlanHistoryBacklog } from '../../../hooks/usePlanHistoryBacklog';
import type { PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';
import { usePeoplePathVisit, type PeoplePathAppearance } from './usePeoplePathVisit';

export type PlanHistoryBacklogProps = { userId: string; onPressPerson: (id: string) => void; appearance?: PeoplePathAppearance; operationScope?: PeopleConnectionScope };
/** Existing completed-plan backlog with a local first-name substring filter.
 * It never performs remote name discovery or expands the received people. */
export default function PlanHistoryBacklog({ userId, onPressPerson, appearance, operationScope }: PlanHistoryBacklogProps) {
  const [input, setInput] = useState({ userId, value: '' });
  const q = input.userId === userId ? input.value : '', normalized = q.trim().toLowerCase();
  const backlog = usePlanHistoryBacklog(userId);
  const visit = usePeoplePathVisit(userId, normalized, operationScope);
  const queryRef = useRef(normalized); queryRef.current = normalized;
  const list = (backlog.data ?? []).filter(p => (p.first_name_display ?? '').toLowerCase().includes(normalized));
  const latest = useRef({ data: backlog.data, list, onPressPerson }); latest.current = { data: backlog.data, list, onPressPerson };
  const eligible = (id: string) => latest.current.data?.some(p => p.user_id === id && p.state === 'none') === true &&
    latest.current.list.some(p => p.user_id === id);
  const loading = backlog.isLoading || visit.reading;
  const failed = backlog.isError && !loading;
  const s = useMemo(() => appearance ? { ...styles, ...backlogAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  return (
    <View style={s.wrap}>
      <View style={s.searchBox}>
        <Search size={18} color={appearance ? AfterglowColors.muted : Colors.tertiary} />
        <TextInput value={q} onChangeText={value => {
          const next = value.trim().toLowerCase();
          if (next !== queryRef.current) { queryRef.current = next; visit.retireQuery(); }
          setInput({ userId, value });
        }} placeholder="Search people from your plans" placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
          autoCorrect={false} accessibilityLabel="Search people from your completed plans" style={s.input} />
      </View>
      {loading ? <View style={s.feedback} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><Text style={s.empty}>Loading people from your plans…</Text></View> : failed ?
        <View style={s.feedback} accessibilityLiveRegion="polite"><Text style={s.feedbackTitle}>Couldn’t load people from your plans.</Text><Text style={s.empty}>Your search is still here.</Text>
          <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel="Try again to load people from your plans" onPress={() => { void visit.refresh(backlog.refetch); }}>
            <Text numberOfLines={1} style={s.retryText}>Try again</Text>
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
              {status?.phase === 'connected' && <Text style={s.rowFeedback} accessibilityLiveRegion="polite">You’re connected.</Text>}
              {status?.phase === 'error' && <View accessibilityLiveRegion="polite"><Text style={s.rowFeedback} accessibilityRole="alert">{status.message}</Text>
                {eligible(item.user_id) && <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel={`Try again to add ${item.first_name_display ?? 'this person'}`} onPress={() => { void visit.add(item.user_id, 'plan_history', () => eligible(item.user_id)); }}>
                  <Text numberOfLines={1} style={s.retryText}>Try again</Text>
                </Pressable>}</View>}
            </View>;
          }} ListEmptyComponent={<View style={s.feedback}><Text style={s.empty}>{normalized ? 'No matches in your past plans. Try another name.' : 'People from completed plans will appear here. Make a plan and meet someone new.'}</Text>
            {!!normalized && <Pressable style={s.retry} accessibilityRole="button" accessibilityLabel="Clear name search" onPress={() => {
              if (!visit.current()) return; queryRef.current = ''; visit.retireQuery(); setInput({ userId, value: '' });
            }}><Text numberOfLines={1} style={s.retryText}>Clear search</Text></Pressable>}
          </View>} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  feedback: { paddingTop: 24, gap: 8 },
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
    height: 44,
    marginBottom: 8,
  },
  input: {
    flex: 1,
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
