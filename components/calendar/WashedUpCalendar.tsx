/**
 * WashedUpCalendar - the one shared brand calendar (brand-calendar-spec.md).
 *
 * Golden Hour themed, built in-house (no library default styling). Opens on the
 * current LA month; past days are faint and disabled; future months are reached
 * by the chevrons OR a horizontal swipe. mode="pick" is single-date selection
 * for the composers. mode="filter" (gold dots over days with plans) is reserved
 * for the discovery layer's When chip and is a stub here. TIME is out of scope:
 * this component owns the DATE only.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, PanResponder, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import {
  MONTHS,
  WEEKDAY_LABELS,
  getTodayInLA,
  isBeforeTodayLA,
  buildMonthGrid,
} from '../../lib/laDate';

export type CalendarDay = { year: number; month: number; day: number };

const DAY_HIGHLIGHT = 40;
const SWIPE_THRESHOLD = 40;

export default function WashedUpCalendar({
  mode = 'pick',
  selected,
  onSelect,
}: {
  mode?: 'pick' | 'filter';
  selected: CalendarDay | null;
  onSelect: (day: CalendarDay) => void;
}) {
  const [view, setView] = useState<{ m: number; y: number }>(() => {
    if (selected) return { m: selected.month, y: selected.year };
    const t = getTodayInLA();
    return { m: t.m, y: t.y };
  });

  // Never page below the current LA month (plans live forward, not in the past).
  const t = getTodayInLA();
  const atCurrentMonth = view.y === t.y && view.m <= t.m;

  const step = (delta: -1 | 1) => {
    setView((cur) => {
      let m = cur.m + delta;
      let y = cur.y;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      const today = getTodayInLA();
      if (y < today.y || (y === today.y && m < today.m)) return cur;
      return { m, y };
    });
    hapticSelection();
  };

  // Horizontal swipe pages months (left = next, right = previous). step() uses a
  // functional update + a fresh getTodayInLA, so the captured handler is safe.
  const pan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -SWIPE_THRESHOLD) step(1);
        else if (g.dx >= SWIPE_THRESHOLD) step(-1);
      },
    }),
  ).current;

  return (
    <View style={styles.surface}>
      <View style={styles.header}>
        <Pressable
          onPress={() => step(-1)}
          disabled={atCurrentMonth}
          hitSlop={8}
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="previous month"
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={atCurrentMonth ? Colors.textLight : Colors.asphalt}
          />
        </Pressable>
        <Text style={styles.monthLabel}>{MONTHS[view.m]} {view.y}</Text>
        <Pressable
          onPress={() => step(1)}
          hitSlop={8}
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="next month"
        >
          <Ionicons name="chevron-forward" size={22} color={Colors.asphalt} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text key={i} style={styles.weekdayLabel}>{label}</Text>
        ))}
      </View>

      <View {...pan.panHandlers}>
        {buildMonthGrid(view.y, view.m).map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((day, ci) => {
              if (day === null) return <View key={ci} style={styles.cell} />;
              const past = isBeforeTodayLA(view.y, view.m, day);
              const isToday = view.y === t.y && view.m === t.m && day === t.d;
              const isSel =
                !!selected && selected.year === view.y && selected.month === view.m && selected.day === day;
              return (
                <Pressable
                  key={ci}
                  style={styles.cell}
                  disabled={past || mode !== 'pick'}
                  onPress={() => {
                    onSelect({ year: view.y, month: view.m, day });
                    hapticLight();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${MONTHS[view.m]} ${day}, ${view.y}`}
                  accessibilityState={{ disabled: past, selected: isSel }}
                >
                  <View
                    style={[
                      styles.dayHighlight,
                      isToday && !isSel && styles.dayToday,
                      isSel && styles.daySelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        past && styles.dayTextDisabled,
                        isSel && styles.dayTextSelected,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: Colors.cream,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  monthLabel: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  navBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  weekdayRow: { flexDirection: 'row', marginBottom: 8 },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', marginBottom: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayHighlight: {
    width: DAY_HIGHLIGHT,
    height: DAY_HIGHLIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: { borderWidth: 1.5, borderColor: Colors.terracotta },
  daySelected: { backgroundColor: Colors.terracotta },
  dayText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  dayTextDisabled: { color: Colors.textLight, opacity: 0.4 },
  dayTextSelected: { color: Colors.cream, fontFamily: Fonts.sansMedium },
});
