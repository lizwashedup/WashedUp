import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import emojiByChar from 'unicode-emoji-json/data-by-emoji.json';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Inline emoji picker rendered INSIDE the keyboard-height panel substrate (not a
// modal), so the input bar stays visible and GIF can become a sibling tab next.
// Pure-JS data (unicode-emoji-json); no native dependency. Skin-tone variants are
// deferred for v1 (base emoji only).

const RECENTS_KEY = 'chat_emoji_recents';
const RECENTS_MAX = 24;
const EMOJI_FONT_SIZE = 30;
const COLUMN_TARGET_WIDTH = 44;
const SEARCH_RESULT_CAP = 200;
const TAB_ICON_FONT_SIZE = 22;

type Group = { name: string; slug: string; emojis: { emoji: string; name: string; slug: string }[] };
const GROUPS = emojiGroups as Group[];
const EMOJI_NAMES = emojiByChar as Record<string, { name: string }>;

// Recents tab uses a clock; each category uses a representative emoji as its tab.
const CATEGORY_TABS: { slug: string; icon: string }[] = [
  { slug: 'recent', icon: '🕘' },
  { slug: 'smileys_emotion', icon: '😀' },
  { slug: 'people_body', icon: '🧑' },
  { slug: 'animals_nature', icon: '🐻' },
  { slug: 'food_drink', icon: '🍔' },
  { slug: 'travel_places', icon: '✈️' },
  { slug: 'activities', icon: '⚽' },
  { slug: 'objects', icon: '💡' },
  { slug: 'symbols', icon: '❤️' },
  { slug: 'flags', icon: '🏳️' },
];

interface EmojiPanelProps {
  onSelect: (emoji: string) => void;
  onBackspace: () => void;
  height: number;
  bottomInset: number;
}

export default function EmojiPanel({ onSelect, onBackspace, height, bottomInset }: EmojiPanelProps) {
  const { width } = useWindowDimensions();
  const [activeSlug, setActiveSlug] = useState('smileys_emotion');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(RECENTS_KEY)
      .then((v) => { if (v) { try { setRecents(JSON.parse(v)); } catch { /* ignore */ } } })
      .catch(() => {});
  }, []);

  const numColumns = Math.max(6, Math.floor(width / COLUMN_TARGET_WIDTH));

  const groupBySlug = useMemo(() => {
    const m = new Map<string, Group>();
    GROUPS.forEach((g) => m.set(g.slug, g));
    return m;
  }, []);

  const data: string[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const out: string[] = [];
      for (const char in EMOJI_NAMES) {
        if ((EMOJI_NAMES[char].name || '').toLowerCase().includes(q)) {
          out.push(char);
          if (out.length >= SEARCH_RESULT_CAP) break;
        }
      }
      return out;
    }
    if (activeSlug === 'recent') return recents;
    return (groupBySlug.get(activeSlug)?.emojis ?? []).map((e) => e.emoji);
  }, [query, activeSlug, recents, groupBySlug]);

  const handlePick = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      setRecents((prev) => {
        const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
        AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <Pressable style={styles.cell} onPress={() => handlePick(item)} accessibilityRole="button" accessibilityLabel={item}>
        <Text style={styles.emoji}>{item}</Text>
      </Pressable>
    ),
    [handlePick],
  );

  return (
    <View style={[styles.panel, { height, paddingBottom: bottomInset }]}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.warmGray} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          placeholderTextColor={Colors.warmGray}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Pressable onPress={onBackspace} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete">
          <Ionicons name="backspace-outline" size={22} color={Colors.warmGray} />
        </Pressable>
      </View>

      <FlashList
        key={`${activeSlug}:${query ? 'q' : 'cat'}`}
        data={data}
        numColumns={numColumns}
        keyExtractor={(item, i) => `${item}:${i}`}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>{activeSlug === 'recent' && !query ? 'No recents yet' : 'No emoji found'}</Text>
        }
      />

      {!query && (
        <View style={styles.tabBar}>
          {CATEGORY_TABS.map((t) => (
            <Pressable
              key={t.slug}
              style={styles.tab}
              onPress={() => setActiveSlug(t.slug)}
              accessibilityRole="button"
              accessibilityLabel={`${t.slug.replace(/_/g, ' ')} emoji`}
            >
              <Text style={[styles.tabIcon, activeSlug === t.slug && styles.tabIconActive]}>{t.icon}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.cardBg,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
  },
  search: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    padding: 0,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: EMOJI_FONT_SIZE,
  },
  empty: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    paddingVertical: 24,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabIcon: {
    fontSize: TAB_ICON_FONT_SIZE,
    opacity: 0.45,
  },
  tabIconActive: {
    opacity: 1,
  },
});
