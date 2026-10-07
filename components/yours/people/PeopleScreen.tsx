import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Search, Plus, Users, ChevronRight } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { RADII, SEARCH } from '../../../constants/YoursDesign';
import { CreatorActionFill } from '../../creator/CreatorActionFill';
import { ScaledText } from '../../ScaledText';
import { COPY } from '../state/constants';
import { isRecentlyActive, compareByFirstName } from '../../../lib/yours/personDisplay';
import WarmPersonAvatar from './WarmPersonAvatar';
import PeopleGridCell from './PeopleGridCell';
import PeopleListRow, { PeopleRecentPerson, type PeopleAppearance } from './PeopleListRow';
import type { AnchorRect } from '../../menu/MenuCard';
import type { YoursGridPerson } from '../../../lib/yours/types';

const COLS = 3;
const GAP = 8;
// Keep the legacy grid geometry; scoped actions measure their own parent.
const CTA_GAP = 10;

/**
 * The People tab body (populated, non-fresh). Faces before utility: a "recently
 * with you" warm row leads, then search, then the dual CTAs, then the everyone
 * grid. While searching, the sections around the search field collapse and
 * PeopleSearchResults renders inline below it; the ScrollView and TextInput
 * stay MOUNTED across the flip (restructuring the tree around a TextInput
 * remounts the native input and drops focus + keyboard after one keystroke).
 */
export default function PeopleScreen({
  people,
  query,
  onQueryChange,
  searchResults,
  pendingRequests,
  onRequestsPress,
  onPersonPress,
  onLongPressPerson,
  onAddPeople,
  onCreateCircle,
  appearance,
}: {
  people: YoursGridPerson[];
  query: string;
  onQueryChange: (v: string) => void;
  searchResults: React.ReactNode;
  pendingRequests: number;
  onRequestsPress: () => void;
  onPersonPress: (p: YoursGridPerson) => void;
  onLongPressPerson: (p: YoursGridPerson, rect: AnchorRect) => void;
  onAddPeople: () => void;
  onCreateCircle: () => void;
  appearance?: PeopleAppearance;
}) {
  const s = useMemo(() => appearance ? { ...styles, ...peopleAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const searching = query.trim().length > 0;

  const { width: screenW, fontScale } = useWindowDimensions();
  const [parentWidth, setParentWidth] = useState<number | null>(null);
  const cellW = (screenW - SEARCH.horizontalInset * 2 - GAP * (COLS - 1)) / COLS;
  const actionWidth = Math.max(0, (appearance ? parentWidth ?? screenW : screenW) - SEARCH.horizontalInset * 2);
  // At larger text sizes, give each label a full row rather than clipping it.
  const stackedActions = !!appearance && (fontScale > 1 || actionWidth < 160 * 2 + CTA_GAP);
  const ctaW = stackedActions ? actionWidth : (actionWidth - CTA_GAP) / 2;

  // When a search begins, the sections above the field collapse; snap the
  // scroll back to the top so the field (and results) are in view even if the
  // grid was scrolled. No animation; the layout change is instant.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (searching) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [searching]);

  const warm = useMemo(() => people.filter(isRecentlyActive), [people]);
  // One shared Intl.Collator (localeCompare with options builds a collator per
  // comparison); explicit cell widths let flexWrap produce the 3-column matrix
  // with no hand chunking or filler views.
  const grid = useMemo(() => [...people].sort(compareByFirstName), [people]);

  const SearchField = (
    <View style={s.search}>
      <Search size={SEARCH.iconSize} color={appearance ? AfterglowColors.muted : Colors.tertiary} strokeWidth={2} />
      <TextInput
        style={s.searchInput}
        accessibilityLabel="Search your people or an exact handle"
        placeholder={COPY.searchPlaceholder}
        placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
        value={query}
        onChangeText={onQueryChange}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
    </View>
  );

  return (
    <ScrollView
      ref={scrollRef}
      onLayout={appearance ? event => {
        const width = event.nativeEvent.layout.width;
        if (Number.isFinite(width) && width > 0) setParentWidth(width);
      } : undefined}
      style={s.fill}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* HERO: recently with you (collapses while searching) */}
      {!searching && warm.length > 0 && (
        <View style={s.warmSection}>
          <View style={s.warmHeader}>
            <Text style={s.warmTitle}>{appearance ? 'Recent people' : COPY.peopleWarmTitle}</Text>
            {!appearance && <View style={s.warmDot} />}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.warmRow}
          >
            {warm.map((p) => (
              appearance ? <PeopleRecentPerson
                key={p.user_id}
                person={p}
                appearance={appearance}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              /> : <WarmPersonAvatar
                key={p.user_id}
                person={p}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              />
            ))}
          </ScrollView>
          <View style={s.divider} />
        </View>
      )}

      {/* Request banner, framed as a gift (reciprocity), not an alert. Inner View
          paints; shown only when there are real incoming requests. Collapses
          while searching (user is mid-task; the field stays put). */}
      {!searching && pendingRequests > 0 && (
        <Pressable
          onPress={onRequestsPress}
          style={({ pressed }) => (pressed ? s.giftPressed : undefined)}
          accessibilityRole="button"
          accessibilityLabel={COPY.peopleGiftTitle(pendingRequests)}
        >
          <View style={s.giftBanner}>
            {!appearance && <View style={s.giftAccent} />}
            <View style={s.giftText}>
              <Text style={s.giftTitle}>
                {COPY.peopleGiftTitle(pendingRequests)}
              </Text>
              <Text style={s.giftSub} numberOfLines={1}>
                {appearance ? 'Review requests' : COPY.peopleGiftSub(pendingRequests)}
              </Text>
            </View>
            <ChevronRight size={20} color={appearance ? AfterglowColors.ink : Colors.asphalt} strokeWidth={2} />
          </View>
        </Pressable>
      )}

      <View style={s.searchWrap}>{SearchField}</View>

      {searching ? (
        // Inline results (PeopleSearchResults renders a plain View); this
        // ScrollView owns the scrolling so the field above never remounts.
        searchResults
      ) : (
        <>
          {/* Keep equal action widths within the measured content area. */}
          <View style={[s.ctaRow, stackedActions && { flexDirection: 'column' }]}>
            <Pressable
              style={({ pressed }) => (pressed ? s.ctaPressed : undefined)}
              onPress={onAddPeople}
              accessibilityRole="button"
              accessibilityLabel="Add people"
            >
              <View style={[s.ctaBtn, { width: ctaW }, s.ctaOutlined]}>
                <Plus size={16} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={2.4} />
                <ScaledText style={[s.ctaOutlinedText, appearance && { textAlign: 'center' }]} numberOfLines={1}>
                  {appearance ? 'Add people' : COPY.peopleListAdd}
                </ScaledText>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => (pressed ? s.ctaPressed : undefined)}
              onPress={onCreateCircle}
              accessibilityRole="button"
              accessibilityLabel="Create a circle"
            >
              <View style={[s.ctaBtn, { width: ctaW }, s.ctaFilled]}>
                {appearance && <CreatorActionFill />}
                <Users size={16} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={2.2} />
                <ScaledText style={[s.ctaFilledText, appearance && { textAlign: 'center' }]} numberOfLines={1}>
                  {appearance ? 'Create a circle' : COPY.peopleCreateCircle}
                </ScaledText>
              </View>
            </Pressable>
          </View>

          {/* Everyone grid (label renders uppercase via textTransform) */}
          <Text style={s.sectionLabel}>{COPY.peopleEveryone(grid.length)}</Text>
          <View style={s.gridWrap}>
            {grid.map((p) => (
              appearance ? <PeopleListRow
                key={p.user_id}
                person={p}
                appearance={appearance}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              /> : <PeopleGridCell
                key={p.user_id}
                person={p}
                width={cellW}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              />
            ))}
          </View>

          <View style={s.bottomSpacer} />
        </>
      )}
    </ScrollView>
  );
}

const H = SEARCH.horizontalInset;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Colors.parchment },
  content: { paddingBottom: 100, paddingTop: 14 },

  warmSection: {},
  warmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: H,
    marginBottom: 12,
  },
  warmTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  warmDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.terracotta,
    marginBottom: 1,
  },
  warmRow: { paddingHorizontal: H, gap: 14, paddingBottom: 4 },
  divider: {
    height: 1,
    backgroundColor: Colors.dividerWarm,
    marginHorizontal: H,
    marginTop: 18,
  },

  giftPressed: { opacity: 0.92 },
  giftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: RADII.cardTight,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginHorizontal: H,
    marginTop: 18,
    shadowColor: Colors.warmShadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  giftAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: Colors.goldAccent,
    borderRadius: 2,
  },
  giftText: { flex: 1, minWidth: 0 },
  giftTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  giftSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  searchWrap: { paddingTop: 16 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    height: SEARCH.fieldHeight,
    borderRadius: SEARCH.fieldRadius,
    backgroundColor: Colors.inputBg,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    paddingHorizontal: 14,
    marginHorizontal: H,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: H,
    marginTop: 16,
    marginBottom: 22,
  },
  ctaPressed: { opacity: 0.85 },
  // Width applied inline from useWindowDimensions (ctaW) so it tracks the
  // live window; everything static stays here.
  ctaBtn: {
    minWidth: 0,
    height: 46,
    flexDirection: 'row',
    gap: 7,
    borderRadius: RADII.buttonTight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOutlined: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.parchment,
  },
  ctaOutlinedText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    flexShrink: 1,
  },
  ctaFilled: {
    backgroundColor: Colors.terracotta,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaFilledText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
    flexShrink: 1,
  },

  // Section-header spec (CLAUDE.md): 11px, 600-weight, brand accent,
  // letter-spacing 1.5, uppercase.
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.5,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    paddingHorizontal: H,
    marginBottom: 12,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GAP,
    rowGap: GAP,
    paddingHorizontal: H,
  },
  bottomSpacer: { height: 24 },
});


/** Per-screen opt-in. No data or global palette changes. */
function peopleAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: AfterglowColors.paper },
    content: { paddingBottom: 100, paddingTop: 16 },
    warmHeader: { ...styles.warmHeader, marginBottom: 8 },
    warmTitle: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted },
    warmRow: { paddingHorizontal: H, gap: 12, paddingBottom: 0 },
    divider: { ...styles.divider, backgroundColor: AfterglowColors.subtleLine, marginTop: 12 },
    giftBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginHorizontal: H, marginTop: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
    giftTitle: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    giftSub: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.clay, marginTop: 2 },
    searchWrap: { paddingTop: 14 },
    search: { ...styles.search, minHeight: 46, height: undefined, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    searchInput: { flex: 1, minWidth: 0, minHeight: 38, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink },
    ctaRow: { ...styles.ctaRow, marginTop: 16, marginBottom: 24 },
    ctaBtn: { ...styles.ctaBtn, minHeight: 46, height: undefined, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 24, borderWidth: 1 },
    ctaOutlined: { borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, backgroundColor: Colors.cardBg },
    ctaOutlinedText: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.clay, flexShrink: 1 },
    ctaFilled: { ...styles.ctaFilled, backgroundColor: AfterglowColors.clay, borderColor: CreatorSurfaceColors.goldEdge, shadowOpacity: 0.24, elevation: 3 },
    ctaFilledText: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.white, flexShrink: 1 },
    sectionLabel: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted, paddingHorizontal: H, marginBottom: 8 },
    gridWrap: { paddingHorizontal: H },
  });
}
