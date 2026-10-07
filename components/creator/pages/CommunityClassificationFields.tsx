import { ScaledText as Text } from '../../ScaledText';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react-native';
import { COMMUNITY_AREAS, COMMUNITY_CATEGORIES } from '../../../lib/communityClassification';
import { AfterglowColors as C, CreatorSurfaceColors as G } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import type { ApplicationFieldGuidance } from '../useApplicationFormGuidance';

const categoryLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const selectedCategories = (values: unknown): string[] => Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];

type Props = {
  area: unknown; categories: unknown; editable: boolean;
  onAreaChange: (value: string) => void; onCategoriesChange: (value: string[]) => void;
  errors: Record<string, string>;
  areaGuidance?: ApplicationFieldGuidance; categoryGuidance?: ApplicationFieldGuidance; areaSearchGuidance?: ApplicationFieldGuidance; searchContentRef?: React.RefObject<View | null>;
};
/** Inline choices stay inside the page editor; selection never saves or publishes. */
export function CommunityClassificationFields({ area, categories, editable, onAreaChange, onCategoriesChange, errors, areaGuidance, categoryGuidance, areaSearchGuidance, searchContentRef }: Props) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const [areaOpen, setAreaOpen] = useState(false), [query, setQuery] = useState('');
  const { fontScale } = useWindowDimensions();
  const searchRef = React.useRef<View | null>(null);
  const measurementFrame = React.useRef<number | null>(null);
  const measurement = React.useRef(0), searchGuidance = React.useRef(areaSearchGuidance);
  React.useLayoutEffect(() => { searchGuidance.current = areaSearchGuidance; }, [areaSearchGuidance]);
  const cancelMeasurement = React.useCallback(() => {
    measurement.current += 1;
    if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current);
    measurementFrame.current = null;
  }, []);
  const measureSearch = React.useCallback(() => {
    cancelMeasurement();
    if (!searchGuidance.current || !searchContentRef?.current || !searchRef.current) return;
    const request = measurement.current;
    measurementFrame.current = requestAnimationFrame(() => {
      measurementFrame.current = null;
      const ancestor = searchContentRef.current, search = searchRef.current, guidance = searchGuidance.current;
      if (!ancestor || !search || !guidance || request !== measurement.current) return;
      // Measure directly against the scroll-content ancestor. Combining a fresh
      // inner offset with a cached outer onLayout.y can consume stale geometry.
      search.measureLayout(ancestor, (x, y, width, height) => {
        if (request !== measurement.current || searchRef.current !== search || searchContentRef.current !== ancestor
          || searchGuidance.current !== guidance || !Number.isFinite(y)) return;
        guidance.onLayout({ nativeEvent: { layout: { x, y, width, height } } } as LayoutChangeEvent);
      });
    });
  }, [cancelMeasurement, searchContentRef]);
  React.useLayoutEffect(() => {
    // Measure even when the search's local position did not emit onLayout.
    if (areaOpen && editable && areaSearchGuidance) measureSearch();
    return cancelMeasurement;
  }, [fontScale, areaOpen, editable, areaSearchGuidance, measureSearch, cancelMeasurement]);
  const areaLayout = (event: LayoutChangeEvent) => {
    areaGuidance?.onLayout(event);
    measureSearch();
  };
  const selected = selectedCategories(categories);
  const areaLabel = typeof area === 'string' && area ? area : 'Choose an area';
  const results = COMMUNITY_AREAS.filter(value => value.toLowerCase().includes(query.trim().toLowerCase()));
  const text = { fontFamily: fonts.regular }, strong = { fontFamily: fonts.medium };
  return <>
    <View onLayout={areaLayout} style={s.field}>
      <Text style={[s.label, strong]}>Area in LA · required</Text>
      <Text style={[s.hint, text]}>Where does your community meet? Choose Many places around LA if you meet across the city.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Area in LA: ${areaLabel}`} accessibilityState={{ expanded: areaOpen, disabled: !editable }}
        disabled={!editable} onPress={() => { if (editable) { setAreaOpen(open => !open); setQuery(''); } }} style={[s.areaControl, !!errors.discovery_area && s.invalid]}>
        <Text style={[s.value, text]}>{areaLabel}</Text>
        {areaOpen ? <ChevronUp size={18} color={C.ink} /> : <ChevronDown size={18} color={C.ink} />}
      </Pressable>
      {errors.discovery_area && <Text accessibilityRole="alert" style={[s.error, text]}>{errors.discovery_area}</Text>}
      {areaOpen && editable && <View style={s.areaChoices}>
        <View ref={searchRef} onLayout={measureSearch} style={s.search}>
          <Search size={17} color={C.muted} />
          <TextInput ref={areaSearchGuidance?.inputRef} accessibilityLabel="Search LA areas" value={query} onChangeText={setQuery}
            onFocus={areaSearchGuidance?.onFocus ?? areaGuidance?.onFocus} onBlur={areaSearchGuidance?.onBlur}
            placeholder="Search areas" placeholderTextColor={C.muted} autoCorrect={false} style={[s.searchInput, text]} />
        </View>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={s.areaResults}>
          {results.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value} accessibilityState={{ checked: area === value }}
            onPress={() => { if (editable) { onAreaChange(value); setAreaOpen(false); setQuery(''); } }} style={[s.areaOption, area === value && s.selected]}>
            <Text style={[s.value, text]}>{value}</Text>{area === value && <Check size={18} color={C.ink} />}
          </Pressable>)}
          {!results.length && <Text style={[s.emptySearch, text]}>Try another area name.</Text>}
        </ScrollView>
      </View>}
    </View>
    <View onLayout={categoryGuidance?.onLayout} style={s.field}>
      <Text style={[s.label, strong]}>Categories · required</Text>
      <Text style={[s.hint, text]}>Choose one or two that fit your community.</Text>
      <View style={s.categories}>
        {selected.filter(value => !COMMUNITY_CATEGORIES.includes(value)).map(value => <Pressable key={value} accessibilityRole="button"
          accessibilityLabel={`Remove unavailable category: ${value}`} disabled={!editable} accessibilityState={{ disabled: !editable }} style={[s.category, s.invalid]}
          onPress={() => { if (editable) onCategoriesChange(selected.filter(item => item !== value)); }}>
          <Text style={[s.categoryText, text]}>{value} · Remove</Text>
        </Pressable>)}
        {COMMUNITY_CATEGORIES.map(value => {
          const checked = selected.includes(value), disabled = !editable || (!checked && selected.length >= 2);
          return <Pressable key={value} accessibilityRole="checkbox" accessibilityLabel={`Category: ${categoryLabel(value)}`} accessibilityState={{ checked, disabled }}
            disabled={disabled} style={[s.category, checked && s.selected, disabled && !checked && s.unavailable]}
            onPress={() => { if (!disabled) onCategoriesChange(checked ? selected.filter(item => item !== value) : [...selected, value]); }}>
            {checked && <Check size={15} color={C.ink} />}<Text style={[s.categoryText, checked ? strong : text]}>{categoryLabel(value)}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={[s.hint, s.selectionHint, text]}>{selected.length >= 2 ? 'Two selected. Remove one to choose another.' : `${selected.length} of 2 selected`}</Text>
      {errors.categories && <Text accessibilityRole="alert" style={[s.error, text]}>{errors.categories}</Text>}
    </View>
  </>;
}
export function CommunityClassificationSummary({ area, categories }: { area: unknown; categories: unknown }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const values = selectedCategories(categories);
  return <View style={s.summary}>
    {typeof area === 'string' && !!area && <Text style={[s.summaryArea, { fontFamily: fonts.medium }]}>{area}</Text>}
    {!!values.length && <Text style={[s.hint, { fontFamily: fonts.regular }]}>{values.map(categoryLabel).join(' · ')}</Text>}
  </View>;
}
const s = StyleSheet.create({
  field: { marginBottom: 24, gap: 8 },
  label: { ...T.body, color: C.ink },
  hint: { ...T.body, color: C.muted },
  areaControl: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  value: { ...T.body, color: C.ink, flex: 1, minWidth: 0 },
  invalid: { borderColor: C.clay },
  areaChoices: { borderWidth: 1, borderColor: G.goldEdge, borderRadius: 12, backgroundColor: C.white, overflow: 'hidden' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  searchInput: { ...T.body, color: C.ink, flex: 1, minWidth: 0, minHeight: 44 },
  areaResults: { maxHeight: 220 },
  areaOption: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selected: { backgroundColor: G.sunsetGoldLight, borderColor: G.sunsetGoldMiddle },
  emptySearch: { ...T.body, color: C.muted, padding: 14 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { minHeight: 44, maxWidth: '100%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  categoryText: { ...T.body, color: C.ink, flexShrink: 1 },
  unavailable: { opacity: 0.5 },
  selectionHint: { marginTop: 2 },
  error: { ...T.body, color: C.clay },
  summary: { gap: 4, marginVertical: 12 },
  summaryArea: { ...T.body, color: C.ink },
});
