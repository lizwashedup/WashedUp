import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView, SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import WashedUpCalendar, { type CalendarDay } from '../calendar/WashedUpCalendar';
import Colors, { CreatorSurfaceColors, SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { formatEventDateLA } from '../../lib/laDate';
import { emptySceneFilters, sceneFilterError, type SceneFilters } from '../../lib/sceneFilters';
import { availableCommunitySelection, type CommunityFilterOptions } from '../../lib/communityDiscoveryFilters';

/** Mount only for an open visit: Cancel never writes drafts back to discovery. */
export function SceneFilterForm({ kind, applied, communityOptions = { categories: [], areas: [] }, onApply, onCancel }: {
  kind: 'events' | 'communities'; applied: SceneFilters;
  communityOptions?: CommunityFilterOptions;
  onApply: (filters: SceneFilters) => void; onCancel: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stackedFooter = width < 360 || fontScale > 1.3;
  const [draft, setDraft] = useState({ ...applied });
  const [calendar, setCalendar] = useState<'from' | 'through' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const communitySelection = availableCommunitySelection(draft, communityOptions);
  const retired = useRef(false);
  useEffect(() => { retired.current = false; return () => { retired.current = true; }; }, []);
  const cancel = () => { if (!retired.current) { retired.current = true; onCancel(); } };
  const apply = () => {
    if (retired.current) return;
    const value = kind === 'communities'
      ? { ...draft, ...communitySelection }
      : { ...draft, query: draft.query.trim(), area: draft.area.trim() };
    const problem = kind === 'events' ? sceneFilterError(value) : null; setError(problem);
    if (!problem) { retired.current = true; onApply(value); }
  };
  const selected = calendar && draft[calendar] ? draft[calendar].split('-').map(Number) : null;
  const pick = (day: CalendarDay) => {
    if (!calendar || retired.current) return;
    setDraft(value => ({ ...value, [calendar]: `${day.year}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}` }));
    setCalendar(null); setError(null);
  };
  return <Modal visible animationType="slide" onRequestClose={cancel} onAccessibilityEscape={cancel}>
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']} accessibilityViewIsModal>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <FilterText fontScale={fontScale} style={styles.title}>{kind === 'events' ? 'Explore events' : 'Community filters'}</FilterText>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel filters" style={styles.quietButton} onPress={cancel}><FilterText fontScale={fontScale} style={styles.link}>Close</FilterText></TouchableOpacity>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {kind === 'communities' ? <>
            <CommunityChoices fontScale={fontScale} label="Category" axis="category" options={communityOptions.categories} value={communitySelection.category}
              allLabel="All categories" emptyLabel="Categories will appear when communities add them."
              onChange={category => setDraft(value => ({ ...value, category }))} />
            <CommunityChoices fontScale={fontScale} label="Areas in LA" axis="area" options={communityOptions.areas} value={communitySelection.area}
              allLabel="All areas" emptyLabel="Areas will appear when communities add them."
              onChange={area => setDraft(value => ({ ...value, area }))} />
          </> : <>
          <FilterText fontScale={fontScale} style={styles.label}>City or area</FilterText>
          <TextInput style={styles.input} accessibilityLabel="City or area" placeholder="Any city or area" placeholderTextColor={Colors.secondary} value={draft.area} onChangeText={area => setDraft(v => ({ ...v, area }))} />
          <FilterText fontScale={fontScale} style={styles.label}>Event or creator</FilterText>
          <TextInput style={styles.input} accessibilityLabel="Filter search" placeholder="Anything in mind?" placeholderTextColor={Colors.secondary} value={draft.query} onChangeText={query => setDraft(v => ({ ...v, query }))} returnKeyType="done" />
            <FilterText fontScale={fontScale} style={styles.label}>When</FilterText>
            <View style={styles.dateRow}>{(['from', 'through'] as const).map(key => <TouchableOpacity key={key} style={[styles.dateButton, calendar === key && styles.dateSelected]}
              accessibilityRole="button" accessibilityLabel={`${key === 'from' ? 'From' : 'Through'} date${draft[key] ? `, ${formatEventDateLA(draft[key])}` : ', any date'}`} accessibilityState={{ expanded: calendar === key }}
              onPress={() => setCalendar(calendar === key ? null : key)}>
              <FilterText fontScale={fontScale} style={styles.dateLabel}>{key === 'from' ? 'From' : 'Through'}</FilterText><FilterText fontScale={fontScale} style={styles.dateValue}>{draft[key] ? formatEventDateLA(draft[key], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Any date'}</FilterText>
            </TouchableOpacity>)}</View>
            {!!calendar && <View style={styles.calendar}>
              <WashedUpCalendar key={calendar} selected={selected ? { year: selected[0], month: selected[1] - 1, day: selected[2] } : null} onSelect={pick} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Clear ${calendar} date`} style={styles.quietButton} onPress={() => { setDraft(v => ({ ...v, [calendar]: '' })); setCalendar(null); setError(null); }}><FilterText fontScale={fontScale} style={styles.link}>Any date</FilterText></TouchableOpacity>
            </View>}
            <FilterText fontScale={fontScale} style={styles.hint}>Either date can be left open.</FilterText>
          </>}
          {!!error && <FilterText fontScale={fontScale} style={styles.error} accessibilityLiveRegion="polite">{error}</FilterText>}
        </ScrollView>
        <View style={[styles.footer, stackedFooter && styles.footerStacked]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear filter draft" style={[styles.quietButton, stackedFooter && styles.clearStacked]} onPress={() => { setDraft(value => kind === 'communities' ? { ...value, category: '', area: '' } : emptySceneFilters()); setCalendar(null); setError(null); }}><FilterText fontScale={fontScale} style={styles.link}>Clear</FilterText></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Show ${kind}`} style={[styles.apply, stackedFooter && styles.applyStacked]} onPress={apply}><FilterText fontScale={fontScale} style={styles.applyText} numberOfLines={1}>Show {kind}</FilterText></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
// iOS can retain old native Text measurements when system text size changes
// inside an open modal. Retire only each Text node, keeping the visit intact.
function FilterText({ fontScale, ...props }: React.ComponentProps<typeof Text> & { fontScale: number }) {
  return <Text key={fontScale} {...props} />;
}
function CommunityChoices({ fontScale, label, axis, options, value, allLabel, emptyLabel, onChange }: {
  fontScale: number; label: string; axis: 'category' | 'area'; options: readonly string[]; value: string;
  allLabel: string; emptyLabel: string; onChange: (value: string) => void;
}) {
  return <View>
    <FilterText fontScale={fontScale} style={styles.label}>{label}</FilterText>
    <View style={styles.choices}>
      {['', ...options].map(option => <TouchableOpacity key={option}
        accessibilityRole="radio" accessibilityLabel={`Community ${axis}: ${option || allLabel}`}
        accessibilityState={{ selected: value === option }}
        style={[styles.choice, value === option && styles.choiceSelected]} onPress={() => onChange(option)}>
        <FilterText fontScale={fontScale} style={[styles.choiceLabel, value === option && styles.choiceLabelSelected]}>{option || allLabel}</FilterText>
      </TouchableOpacity>)}
    </View>
    {!options.length && <FilterText fontScale={fontScale} style={styles.hint}>{emptyLabel}</FilterText>}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment }, flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, gap: 12 },
  title: { flex: 1, fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.darkWarm },
  content: { padding: 20, paddingTop: 8, paddingBottom: 24 },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 8, marginTop: 16 },
  input: { minHeight: 44, borderRadius: 8, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.borderWarm, padding: 12, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { minHeight: 44, maxWidth: '100%', borderRadius: 22, borderWidth: 1, borderColor: Scene.border, backgroundColor: Scene.surface, paddingVertical: 10, paddingHorizontal: 14, justifyContent: 'center' },
  choiceSelected: { borderColor: Scene.action, backgroundColor: CreatorSurfaceColors.sunsetGoldLight },
  choiceLabel: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.supporting },
  choiceLabelSelected: { fontFamily: Fonts.sansMedium, color: Scene.text },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dateButton: { flexGrow: 1, flexBasis: 120, minHeight: 60, borderWidth: 1, borderColor: Colors.borderWarm, backgroundColor: Colors.white, borderRadius: 8, padding: 10, gap: 4 },
  dateSelected: { borderColor: Colors.terracotta },
  dateLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.secondary },
  dateValue: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  calendar: { marginTop: 12 },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 8 },
  error: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.errorRed, marginTop: 16 },
  quietButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  link: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  footer: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Colors.borderWarm, alignItems: 'center', gap: 16 },
  footerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  clearStacked: { alignSelf: 'flex-start' },
  applyStacked: { flex: 0 },
  apply: { flex: 1, minHeight: 48, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
