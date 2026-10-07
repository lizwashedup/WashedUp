import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { EVENT_CATEGORIES, eventCategories, toggleEventCategory } from '../../../lib/eventCategories';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import Colors, { AfterglowColors as C } from '../../../constants/Colors';
import { AfterglowType as T } from '../../../constants/Typography';
import { pageStyles } from './PageFrame';
import { GoldSurfaceFill } from '../GoldSurfaceFill';

export function CreatorEventDraftFields({ title, categories, community=false, ready, onTitle, onCategories }: {
  title: string; categories: string[]; community?: boolean; ready: boolean; onTitle: (value: string) => void; onCategories: (value: string[]) => void;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const [focused, setFocused] = useState(false);
  return <View style={s.fields}>
    <View style={s.field}>
      <Text style={[s.label, { fontFamily: fonts.semibold }]}>Event title</Text>
      <View style={[s.inputSurface, focused && s.inputFocused]}>
        <TextInput accessibilityLabel="Event title" value={title} onChangeText={onTitle} maxLength={120} editable={ready}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} selectionColor={Colors.terracotta}
          placeholder="Give it a name" placeholderTextColor={C.muted} style={[pageStyles.input, s.input, { fontFamily: fonts.regular }]} />
      </View>
    </View>
    <CreatorEventCategoryFields categories={categories} community={community} ready={ready} onCategories={onCategories} />
  </View>;
}
export function CreatorEventCategoryFields({categories,community=false,ready,onCategories}: {categories:string[];community?:boolean;ready:boolean;onCategories:(values:string[])=>void}) {
 const {fonts}=useAfterglowFonts(true,'creator');
 const selected=eventCategories({categories},community);
 return <View style={s.field}>
      <Text style={[s.label, { fontFamily: fonts.semibold }]}>Categories</Text>
      <Text style={[s.help,{fontFamily:fonts.regular}]}>{community?'Community is included. Choose one more if you like.':'Choose one or two.'}</Text>
      <View style={s.categories}>{[...EVENT_CATEGORIES,...selected.filter(v=>!EVENT_CATEGORIES.includes(v))].map(value => <Pressable cssInterop={false} key={value} accessibilityRole="checkbox"
        accessibilityLabel={`Category: ${value}`} accessibilityState={{ checked: selected.includes(value), disabled: !ready || (community && value==='community') || (!selected.includes(value) && selected.length===2) }} aria-checked={selected.includes(value)} disabled={!ready || (community && value==='community') || (!selected.includes(value) && selected.length===2)}
        onPress={() => onCategories(toggleEventCategory(selected,value,community))} style={({ pressed }) => [s.category, selected.includes(value) && s.selected, pressed && s.pressed]}>
        {selected.includes(value) && <GoldSurfaceFill radius={12} />}
        
        <Text style={[s.categoryText, { fontFamily: fonts.medium }]}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
      </Pressable>)}</View>
    </View>;
}
const s = StyleSheet.create({
  help: {...T.caption,color:C.muted,marginTop:-6},
  fields: { gap: 28 }, field: { gap: 12 }, label: { ...T.body, color: C.ink },
  inputSurface: { borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: Colors.white,
    shadowColor: C.ink, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 9, elevation: 1 },
  inputFocused: { borderColor: Colors.terracotta, shadowColor: Colors.terracotta, shadowOpacity: 0.12 },
  input: { minHeight: 58, paddingHorizontal: 18, paddingVertical: 16, borderWidth: 0, borderRadius: 14 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  category: { minHeight: 56, width: '48%', flexGrow: 1, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.subtleLine,
    backgroundColor: Colors.white, shadowColor: C.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.035, shadowRadius: 4, elevation: 1 },
  selected: { borderColor: Colors.goldAccent, shadowOpacity: 0.09 },
  pressed: { opacity: 0.8 },
  categoryText: { ...T.body, color: C.ink, flexShrink: 1, textAlign: 'center' },
});
