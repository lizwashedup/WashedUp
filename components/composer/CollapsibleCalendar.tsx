/**
 * CollapsibleCalendar - the WHEN date control. Rests as a compact row showing
 * the chosen day (or a placeholder); tapping expands the full WashedUpCalendar
 * with the design study's calendar-expand spring (mass 0.8 / stiffness 300 /
 * damping 28), and it collapses back the moment a day is tapped. Shared by both
 * composer surfaces. Time stays the host composer's mechanic.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { getTodayInLA, MONTHS } from '../../lib/laDate';
import { hapticLight } from '../../lib/haptics';
import WashedUpCalendar, { type CalendarDay } from '../../components/calendar/WashedUpCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CollapsibleCalendarProps {
  appearance?: { fonts: AfterglowFontFamilies };
  selected: CalendarDay | null;
  onSelect: (day: CalendarDay) => void;
  placeholder?: string;
}

export default function CollapsibleCalendar({
  selected,
  onSelect,
  placeholder = 'pick a day',
  appearance,
}: CollapsibleCalendarProps) {
  const styles = useMemo(() => calendarStyles(appearance), [appearance]);
  const [expanded, setExpanded] = useState(false);
  const today = getTodayInLA();
  const tomorrowUtc = new Date(Date.UTC(today.y, today.m, today.d + 1));
  const shortcuts: { label: string; day: CalendarDay }[] = [
    { label: 'Today', day: { year: today.y, month: today.m, day: today.d } },
    { label: 'Tomorrow', day: { year: tomorrowUtc.getUTCFullYear(), month: tomorrowUtc.getUTCMonth(), day: tomorrowUtc.getUTCDate() } },
  ];

  const label = selected
    ? `${WEEKDAYS[new Date(selected.year, selected.month, selected.day).getDay()]}, ${MONTHS[selected.month]} ${selected.day}${selected.year !== today.y ? `, ${selected.year}` : ''}`
    : placeholder;

  return (
    <View>
      <Pressable style={styles.row} onPress={() => { hapticLight(); setExpanded((v) => !v); }} accessibilityRole="button" accessibilityLabel={`Date, ${label}`} accessibilityState={{ expanded }}>
        <Text style={[styles.rowText, !selected && styles.rowPlaceholder]}>{label}</Text>
        {expanded
          ? <ChevronUp size={18} color={appearance ? AfterglowColors.muted : Colors.secondary} />
          : <ChevronDown size={18} color={appearance ? AfterglowColors.muted : Colors.secondary} />}
      </Pressable>

      {expanded && (
        <Animated.View
          entering={FadeInDown.springify().mass(0.8).damping(28).stiffness(300)}
          exiting={FadeOutUp.duration(160)}
          style={styles.calWrap}
        >
          <View style={styles.shortcuts}>
            {shortcuts.map(({ label: shortcutLabel, day }) => (
              <Pressable key={shortcutLabel} style={styles.shortcut} accessibilityRole="button" accessibilityLabel={`Choose ${shortcutLabel.toLowerCase()}`} onPress={() => { hapticLight(); onSelect(day); setExpanded(false); }}>
                <Text style={styles.shortcutText}>{shortcutLabel}</Text>
              </Pressable>
            ))}
          </View>
          <WashedUpCalendar
            appearance={appearance}
            mode="pick"
            selected={selected}
            onSelect={(d) => { onSelect(d); setExpanded(false); }}
          />
        </Animated.View>
      )}
    </View>
  );
}

const legacyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
  },
  rowText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  rowPlaceholder: { fontFamily: Fonts.sans, color: Colors.tertiary },
  calWrap: {
    marginTop: 10, borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white, overflow: 'hidden',
  },
  shortcuts: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 10 },
  shortcut: { borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cream, paddingHorizontal: 14, paddingVertical: 9 },
  shortcutText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
});


function calendarStyles(appearance?: { fonts: AfterglowFontFamilies }) {
  if (!appearance) return legacyStyles;
  const { fonts } = appearance;
  return { ...legacyStyles, ...StyleSheet.create({
    row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      backgroundColor: AfterglowColors.white, borderWidth: 1, borderColor: AfterglowColors.line,
      borderRadius: 6, paddingHorizontal: 12, paddingVertical: 12 },
    rowText: { flex: 1, ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    rowPlaceholder: { fontFamily: fonts.regular, color: AfterglowColors.muted },
    calWrap: { marginTop: 10, borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line,
      backgroundColor: AfterglowColors.white, overflow: 'hidden' },
    shortcut: { minHeight: 44, borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line,
      backgroundColor: AfterglowColors.paper, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
    shortcutText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
  }) };
}
