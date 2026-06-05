/**
 * PeopleStep - step 2 of the create-circle flow: multi-select from the people
 * you already have. A circle is three or more, so the flow requires at least
 * two picks (you make three). If you have no people yet, this points at the
 * prerequisite instead.
 */
import React from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { Check, UserPlus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { CIRCLE_CREATE, CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { YoursGridPerson } from '../../../lib/yours/types';

function PickRow({
  person,
  selected,
  onToggle,
}: {
  person: YoursGridPerson;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onToggle();
      }}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      {person.profile_photo_url ? (
        <Image source={{ uri: person.profile_photo_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.initial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Check size={16} color={Colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

export default function PeopleStep({
  people,
  selected,
  onToggle,
  onAddPeople,
}: {
  people: YoursGridPerson[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAddPeople: () => void;
}) {
  if (people.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyBubble}>
          <UserPlus size={CIRCLE.emptyIcon} color={Colors.terracotta} strokeWidth={1.5} />
        </View>
        <Text style={styles.emptyTitle}>{COPY.circleNoPeopleTitle}</Text>
        <Text style={styles.emptySub}>{COPY.circleNoPeopleSub}</Text>
        <Pressable
          onPress={onAddPeople}
          style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleNoPeopleCta}
        >
          <Text style={styles.emptyCtaLabel}>{COPY.circleNoPeopleCta}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Text style={styles.title}>{COPY.circleStep2Title}</Text>
      <Text style={styles.sub}>{COPY.circleStep2Sub}</Text>
      {selected.size > 0 && (
        <Text style={styles.count}>{COPY.circlePickedCount(selected.size)}</Text>
      )}
      <FlatList
        data={people}
        keyExtractor={(p) => p.user_id}
        renderItem={({ item }) => (
          <PickRow
            person={item}
            selected={selected.has(item.user_id)}
            onToggle={() => onToggle(item.user_id)}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  count: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  listContent: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: CIRCLE_CREATE.pickRowPadV,
    gap: 14,
  },
  avatar: {
    width: CIRCLE_CREATE.pickAvatar,
    height: CIRCLE_CREATE.pickAvatar,
    borderRadius: CIRCLE_CREATE.pickAvatar / 2,
    backgroundColor: Colors.inputBg,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  name: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  check: {
    width: CIRCLE_CREATE.pickCheck,
    height: CIRCLE_CREATE.pickCheck,
    borderRadius: CIRCLE_CREATE.pickCheck / 2,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  // Empty (no people yet)
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyBubble: {
    width: CIRCLE.emptyBubble,
    height: CIRCLE.emptyBubble,
    borderRadius: CIRCLE.emptyBubbleRadius,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: CIRCLE.emptyBubbleGap,
  },
  emptyTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  emptyCta: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  pressed: { opacity: 0.85 },
  emptyCtaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
