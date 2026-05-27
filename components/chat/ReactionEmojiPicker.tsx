import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import emojiByChar from 'unicode-emoji-json/data-by-emoji.json';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Full-emoji picker for message reactions: the "+" on the quick-react row opens
// this so any emoji can be a reaction, not just the six quick ones (WhatsApp
// pattern). Shares the emoji data + recents key with MediaPanel so recents stay
// consistent across the input picker and reactions. Bottom-sheet, not a panel.

const RECENTS_KEY = 'chat_emoji_recents';
const RECENTS_MAX = 24;
const EMOJI_FONT_SIZE = 30;
const COLUMN_TARGET_WIDTH = 44;
const SEARCH_RESULT_CAP = 200;
const CATEGORY_ICON_FONT_SIZE = 22;
const SHEET_HEIGHT_RATIO = 0.62;

type Group = { name: string; slug: string; emojis: { emoji: string; name: string; slug: string }[] };
const GROUPS = emojiGroups as Group[];
const EMOJI_NAMES = emojiByChar as Record<string, { name: string }>;

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

interface ReactionEmojiPickerProps {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function ReactionEmojiPicker({ visible, onSelect, onClose }: ReactionEmojiPickerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeSlug, setActiveSlug] = useState('smileys_emotion');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setActiveSlug('smileys_emotion');
    AsyncStorage.getItem(RECENTS_KEY)
      .then((v) => { if (v) { try { setRecents(JSON.parse(v)); } catch { /* ignore */ } } })
      .catch(() => {});
  }, [visible]);

  const numColumns = Math.max(6, Math.floor(width / COLUMN_TARGET_WIDTH));

  const groupBySlug = useMemo(() => {
    const m = new Map<string, Group>();
    GROUPS.forEach((g) => m.set(g.slug, g));
    return m;
  }, []);

  const emojiData: string[] = useMemo(() => {
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
      setRecents((prev) => {
        const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
        AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      onSelect(emoji);
    },
    [onSelect],
  );

  const renderEmoji = useCallback(
    ({ item }: { item: string }) => (
      <Pressable style={styles.cell} onPress={() => handlePick(item)} accessibilityRole="button" accessibilityLabel={item}>
        <Text style={styles.emoji}>{item}</Text>
      </Pressable>
    ),
    [handlePick],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { height: height * SHEET_HEIGHT_RATIO, paddingBottom: insets.bottom }]}
        >
          <View style={styles.grabber} />

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
          </View>

          <FlashList
            key={`${activeSlug}:${query ? 'q' : 'cat'}`}
            data={emojiData}
            numColumns={numColumns}
            keyExtractor={(item, i) => `${item}:${i}`}
            renderItem={renderEmoji}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>{activeSlug === 'recent' && !query ? 'No recents yet' : 'No emoji found'}</Text>
            }
          />

          {!query && (
            <View style={styles.catBar}>
              {CATEGORY_TABS.map((t) => (
                <Pressable
                  key={t.slug}
                  style={styles.cat}
                  onPress={() => setActiveSlug(t.slug)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.slug.replace(/_/g, ' ')} emoji`}
                >
                  <Text style={[styles.catIcon, activeSlug === t.slug && styles.catIconActive]}>{t.icon}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark40,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: 10,
    marginBottom: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
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
  catBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  cat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  catIcon: {
    fontSize: CATEGORY_ICON_FONT_SIZE,
    opacity: 0.45,
  },
  catIconActive: {
    opacity: 1,
  },
});
