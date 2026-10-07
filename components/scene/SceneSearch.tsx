import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { Search, X, SlidersHorizontal } from 'lucide-react-native';
import { SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

/** Each mounted destination owns its unsubmitted text and applied query independently. */
export function SceneSearch({ kind, draft, setDraft, onApply, onOpenFilters, filterCount = 0 }: { kind: 'events' | 'communities'; draft: string; setDraft: (value: string) => void; onApply: (query: string) => void; onOpenFilters: () => void; filterCount?: number }) {
  const submit = () => { onApply(draft.trim()); Keyboard.dismiss(); };
  return <View style={styles.row}>
    <TextInput style={styles.input} value={draft} onChangeText={setDraft}
      placeholder={`Search ${kind}`} accessibilityLabel={`Search ${kind}`}
      placeholderTextColor={Scene.supporting} returnKeyType="search" onSubmitEditing={submit}
      autoCorrect={false} autoCapitalize="none" selectionColor={Scene.text} />
    {!!draft && <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={`Clear ${kind} search`}
      onPress={() => { setDraft(''); onApply(''); }}><X size={17} color={Scene.supporting} /></TouchableOpacity>}
    <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={`Apply ${kind} search`} onPress={submit}>
      <Search size={19} color={Scene.text} />
    </TouchableOpacity>
    <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={`Filter ${kind}${filterCount ? `, ${filterCount} active` : ''}`} onPress={onOpenFilters}>
      <SlidersHorizontal size={18} color={Scene.text} />
      {filterCount > 0 && <View style={styles.activeDot} />}
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Scene.border, backgroundColor: Scene.surface, borderRadius: 8, marginBottom: 12 },
  input: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.text },
  activeDot: { position: 'absolute', top: 8, right: 8, width: 5, height: 5, borderRadius: 3, backgroundColor: Scene.text },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
