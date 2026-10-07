import React from 'react';
import { ChatSizedText } from '../chat/ChatSizedText';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export function ChatInboxHeading({ fonts, children }: { fonts: AfterglowFontFamilies; children?: React.ReactNode }) {
  return <View style={styles.heading}><ChatSizedText accessibilityRole="header" style={[styles.title, { fontFamily: fonts.display }]}>Chats</ChatSizedText>{children}</View>;
}

export function ChatInboxFilters<T extends string>({ fonts, value, choices, onChange }: {
  fonts: AfterglowFontFamilies; value: T; choices: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void;
}) {
  return <View style={styles.filters}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
      {choices.map(([key, label]) => <TouchableOpacity key={key} onPress={() => onChange(key)} accessibilityRole="tab" accessibilityState={{ selected: key === value }} aria-selected={key === value} style={styles.tab} activeOpacity={0.7}>
        <Text numberOfLines={1} style={[styles.label, { fontFamily: key === value ? fonts.semibold : fonts.medium, color: key === value ? Colors.ink : Colors.muted }]}>{label}</Text>
        {key === value && <View style={styles.underline} />}
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 16 },
  title: { ...AfterglowType.screenTitle, color: Colors.ink, flexShrink: 1 },
  filters: { marginBottom: 6 },
  filtersContent: { paddingHorizontal: 20, gap: 24 },
  tab: { minHeight: 44, justifyContent: 'center', paddingBottom: 8, paddingTop: 6 },
  label: { ...AfterglowType.body },
  underline: { position: 'absolute', height: 2, left: 0, right: 0, bottom: 0, backgroundColor: Colors.clay },
});
