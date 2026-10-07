/**
 * PeopleStep - step 1 of the create-circle flow: multi-select from the people
 * you already have. A circle is three or more, so the flow requires at least
 * two picks (you make three). If you have no people yet, this points at the
 * prerequisite instead.
 */
import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Check, UserPlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_CREATE, CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { usePickerFilter } from '../../../hooks/usePickerFilter';
import PeopleSearchBar from '../../yours/search/PeopleSearchBar';
import CreationPersonPhoto from './CreationPersonPhoto';
import type { YoursGridPerson } from '../../../lib/yours/types';

function PickRow({
  person,
  selected,
  onToggle,
  appearance,
}: {
  person: YoursGridPerson;
  selected: boolean;
  onToggle: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  const handle = person.handle?.trim().replace(/^@+/, '');
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onToggle();
      }}
      style={styled.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={handle ? `${name}, @${handle}` : name}
    >
      {appearance ? <CreationPersonPhoto person={person} fonts={appearance.fonts}/> : person.profile_photo_url ? (
        <Image source={{ uri: person.profile_photo_url }} style={styled.avatar} />
      ) : (
        <View style={[styled.avatar, styled.avatarFallback]}>
          <Text style={styled.initial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styled.identity}>
        <Text style={styled.name} numberOfLines={appearance ? undefined : 1}>
          {name}
        </Text>
        {!!handle && <Text style={styled.handle} numberOfLines={1}>@{handle}</Text>}
      </View>
      <View style={[styled.check, selected && styled.checkOn]}>
        {selected && <Check size={16} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

export default function PeopleStep({
  people,
  selected,
  onToggle,
  onAddPeople,
  appearance,
}: {
  people: YoursGridPerson[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAddPeople: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const [ctaPressed, setCtaPressed] = useState(false);
  // Search appears only past the threshold; selected people stay visible.
  const { query, setQuery, showSearch, filtered } = usePickerFilter(
    people,
    (p) => selected.has(p.user_id),
  );
  if (people.length === 0) {
    const EmptyContainer = appearance ? ScrollView : View;
    return (
      <EmptyContainer {...(appearance ? { contentContainerStyle: styled.emptyWrap } : { style: styled.emptyWrap })}>
        <View style={styled.emptyBubble}>
          <UserPlus size={CIRCLE.emptyIcon} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={1.5} />
        </View>
        <Text style={styled.emptyTitle}>{COPY.circleNoPeopleTitle}</Text>
        <Text style={styled.emptySub}>{COPY.circleNoPeopleSub}</Text>
        <Pressable
          onPress={onAddPeople}
          onPressIn={() => setCtaPressed(true)}
          onPressOut={() => setCtaPressed(false)}
          style={[styled.emptyCta, ctaPressed && styled.pressed]}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleNoPeopleCta}
        >
          <Text numberOfLines={1} style={styled.emptyCtaLabel}>{COPY.circleNoPeopleCta}</Text>
        </Pressable>
      </EmptyContainer>
    );
  }

  return (
    <View style={styled.flex}>
      <Text style={styled.title}>{COPY.circleStep2Title}</Text>
      <Text style={styled.sub}>{COPY.circleStep2Sub}</Text>
      {selected.size > 0 && (
        <Text style={styled.count}>{COPY.circlePickedCount(selected.size)}</Text>
      )}
      {showSearch && <PeopleSearchBar value={query} onChange={setQuery} appearance={appearance}/>}
      <FlatList
        data={showSearch ? filtered : people}
        keyExtractor={(p) => p.user_id}
        renderItem={({ item }) => (
          <PickRow
            appearance={appearance}
            person={item}
            selected={selected.has(item.user_id)}
            onToggle={() => onToggle(item.user_id)}
          />
        )}
        contentContainerStyle={styled.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
  identity: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  handle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
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

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  title: { ...styles.title, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
  sub: { ...styles.sub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  count: { ...styles.count, ...AfterglowType.caption, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  row: { marginHorizontal: 20, minHeight: 82, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  name: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  handle: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  check: { ...styles.check, borderRadius: 4, borderColor: AfterglowColors.line },
  checkOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  emptyTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center' },
  emptySub: { ...styles.emptySub, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  emptyBubble: { ...styles.emptyBubble, backgroundColor: AfterglowColors.paper },
  emptyCta: { minHeight: 44, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 4, backgroundColor: AfterglowColors.clay, justifyContent: 'center' },
  emptyCtaLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
}); }
