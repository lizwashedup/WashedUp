import React, { useEffect, useMemo, useRef } from 'react';
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
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { RADII, SEARCH } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { isRecentlyActive, compareByFirstName } from '../../../lib/yours/personDisplay';
import WarmPersonAvatar from './WarmPersonAvatar';
import PeopleGridCell from './PeopleGridCell';
import type { AnchorRect } from '../../menu/MenuCard';
import type { YoursGridPerson } from '../../../lib/yours/types';

const COLS = 3;
const GAP = 8;
// Explicit half-width gap for the dual CTAs (flex:1 was rendering them unequal;
// the grid uses explicit widths reliably, so we match that). Widths themselves
// come from useWindowDimensions inside the component so they track the live
// window (split-screen / multi-window), never a stale module-load snapshot.
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
}) {
  const searching = query.trim().length > 0;

  const { width: screenW } = useWindowDimensions();
  const cellW = (screenW - SEARCH.horizontalInset * 2 - GAP * (COLS - 1)) / COLS;
  const ctaW = (screenW - SEARCH.horizontalInset * 2 - CTA_GAP) / 2;

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
    <View style={styles.search}>
      <Search size={SEARCH.iconSize} color={Colors.tertiary} strokeWidth={2} />
      <TextInput
        style={styles.searchInput}
        placeholder={COPY.searchPlaceholder}
        placeholderTextColor={Colors.tertiary}
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
      style={styles.fill}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* HERO: recently with you (collapses while searching) */}
      {!searching && warm.length > 0 && (
        <View style={styles.warmSection}>
          <View style={styles.warmHeader}>
            <Text style={styles.warmTitle}>{COPY.peopleWarmTitle}</Text>
            <View style={styles.warmDot} />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.warmRow}
          >
            {warm.map((p) => (
              <WarmPersonAvatar
                key={p.user_id}
                person={p}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              />
            ))}
          </ScrollView>
          <View style={styles.divider} />
        </View>
      )}

      {/* Request banner, framed as a gift (reciprocity), not an alert. Inner View
          paints; shown only when there are real incoming requests. Collapses
          while searching (user is mid-task; the field stays put). */}
      {!searching && pendingRequests > 0 && (
        <Pressable
          onPress={onRequestsPress}
          style={({ pressed }) => (pressed ? styles.giftPressed : undefined)}
          accessibilityRole="button"
          accessibilityLabel={COPY.peopleGiftTitle(pendingRequests)}
        >
          <View style={styles.giftBanner}>
            <View style={styles.giftAccent} />
            <View style={styles.giftText}>
              <Text style={styles.giftTitle}>
                {COPY.peopleGiftTitle(pendingRequests)}
              </Text>
              <Text style={styles.giftSub} numberOfLines={1}>
                {COPY.peopleGiftSub(pendingRequests)}
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.asphalt} strokeWidth={2} />
          </View>
        </Pressable>
      )}

      <View style={styles.searchWrap}>{SearchField}</View>

      {searching ? (
        // Inline results (PeopleSearchResults renders a plain View); this
        // ScrollView owns the scrolling so the field above never remounts.
        searchResults
      ) : (
        <>
          {/* Dual CTAs: explicit half-width Pressables with the fill applied
              directly (the "Done" button pattern; inner-View + width:'100%'
              nesting was rendering them unequal/overflowing). */}
          <View style={styles.ctaRow}>
            <Pressable
              style={({ pressed }) => (pressed ? styles.ctaPressed : undefined)}
              onPress={onAddPeople}
              accessibilityRole="button"
              accessibilityLabel="Add people"
            >
              <View style={[styles.ctaBtn, { width: ctaW }, styles.ctaOutlined]}>
                <Plus size={16} color={Colors.terracotta} strokeWidth={2.4} />
                <Text style={styles.ctaOutlinedText} numberOfLines={1}>
                  {COPY.peopleListAdd}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => (pressed ? styles.ctaPressed : undefined)}
              onPress={onCreateCircle}
              accessibilityRole="button"
              accessibilityLabel="Create a circle"
            >
              <View style={[styles.ctaBtn, { width: ctaW }, styles.ctaFilled]}>
                <Users size={16} color={Colors.white} strokeWidth={2.2} />
                <Text style={styles.ctaFilledText} numberOfLines={1}>
                  {COPY.peopleCreateCircle}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* Everyone grid (label renders uppercase via textTransform) */}
          <Text style={styles.sectionLabel}>{COPY.peopleEveryone(grid.length)}</Text>
          <View style={styles.gridWrap}>
            {grid.map((p) => (
              <PeopleGridCell
                key={p.user_id}
                person={p}
                width={cellW}
                onPress={onPersonPress}
                onLongPress={onLongPressPerson}
              />
            ))}
          </View>

          <View style={styles.bottomSpacer} />
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
    fontFamily: Fonts.displayItalic,
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
