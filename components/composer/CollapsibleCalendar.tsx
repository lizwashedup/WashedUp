/**
 * CollapsibleCalendar - the WHEN date control. Rests as a compact row showing
 * the chosen day (or a placeholder); tapping expands the full WashedUpCalendar
 * with the design study's calendar-expand spring (mass 0.8 / stiffness 300 /
 * damping 28), and it collapses back the moment a day is tapped. Shared by both
 * composer surfaces. Time stays the host composer's mechanic.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { MONTHS } from '../../lib/laDate';
import { hapticLight } from '../../lib/haptics';
import WashedUpCalendar, { type CalendarDay } from '../../components/calendar/WashedUpCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CollapsibleCalendarProps {
  selected: CalendarDay | null;
  onSelect: (day: CalendarDay) => void;
  placeholder?: string;
}

export default function CollapsibleCalendar({
  selected,
  onSelect,
  placeholder = 'pick a day',
}: CollapsibleCalendarProps) {
  const [expanded, setExpanded] = useState(false);

  const label = selected
    ? `${WEEKDAYS[new Date(selected.year, selected.month, selected.day).getDay()]}, ${MONTHS[selected.month]} ${selected.day}`
    : placeholder;

  return (
    <View>
      <Pressable style={styles.row} onPress={() => { hapticLight(); setExpanded((v) => !v); }}>
        <Text style={[styles.rowText, !selected && styles.rowPlaceholder]}>{label}</Text>
        {expanded
          ? <ChevronUp size={18} color={Colors.secondary} />
          : <ChevronDown size={18} color={Colors.secondary} />}
      </Pressable>

      {expanded && (
        <Animated.View
          entering={FadeInDown.springify().mass(0.8).damping(28).stiffness(300)}
          exiting={FadeOutUp.duration(160)}
          style={styles.calWrap}
        >
          <WashedUpCalendar
            mode="pick"
            selected={selected}
            onSelect={(d) => { onSelect(d); setExpanded(false); }}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
