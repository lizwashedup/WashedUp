import React, { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet, useWindowDimensions, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Search, X } from 'lucide-react-native';
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
const EMOJI_FONT_SIZE = FontSizes.displayLG;
const COLUMN_TARGET_WIDTH = 44;
const SEARCH_RESULT_CAP = 200;
const CATEGORY_ICON_FONT_SIZE = FontSizes.displayMD;
const SHEET_HEIGHT_RATIO = 0.62;

type Group = { name: string; slug: string; emojis: { emoji: string; name: string; slug: string }[] };
const GROUPS = emojiGroups as Group[];
const EMOJI_NAMES = emojiByChar as Record<string, { name: string }>;
// Keep existing skin-tone recents even though the base picker data omits variants.
const emojiName = (emoji: string) => EMOJI_NAMES[emoji]?.name
  ?? EMOJI_NAMES[emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')]?.name;

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
  const opening = useMemo(() => ({}), [visible]);
  const activeOpening = useRef<object | null>(null);
  const picked = useRef(false);
  useLayoutEffect(() => {
    activeOpening.current = visible ? opening : null; picked.current = false;
    return () => { activeOpening.current = null; };
  }, [visible, opening]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setActiveSlug('smileys_emotion');
    setRecents([]);
    AsyncStorage.getItem(RECENTS_KEY).then(value => {
      if (activeOpening.current !== opening || picked.current) return;
      try {
        const parsed: unknown = JSON.parse(value ?? '[]');
        setRecents(Array.isArray(parsed) ? [...new Set(parsed.filter((emoji): emoji is string => typeof emoji === 'string' && !!emojiName(emoji)))].slice(0, RECENTS_MAX) : []);
      } catch { setRecents([]); }
    }).catch(() => {});
  }, [visible, opening]);

  const sheetWidth = Math.min(width, 480);
  const numColumns = Math.max(1, Math.floor(sheetWidth / COLUMN_TARGET_WIDTH));

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
      if (activeOpening.current !== opening || picked.current) return;
      picked.current = true;
      const next = [emoji, ...recents.filter(item => item !== emoji)].slice(0, RECENTS_MAX);
      setRecents(next);
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
      onSelect(emoji);
    },
    [onSelect, opening, recents],
  );

  const handleClose = useCallback(() => {
    if (activeOpening.current !== opening) return;
    activeOpening.current = null;
    onClose();
  }, [onClose, opening]);

  const renderEmoji = useCallback(
    ({ item }: { item: string }) => (
      <Pressable style={styles.cell} onPress={() => handlePick(item)} accessibilityRole="button" accessibilityLabel={`React with ${emojiName(item) ?? item}`}>
        <Text allowFontScaling={false} style={styles.emoji}>{item}</Text>
      </Pressable>
    ),
    [handlePick],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close reactions" />
        <View accessibilityViewIsModal style={[styles.sheet, { width: sheetWidth, height: Math.min(560, height * SHEET_HEIGHT_RATIO), paddingBottom: insets.bottom }]}>
          <View style={styles.grabber} />
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">Reactions</Text>
            <Pressable style={styles.close} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close reactions"><X size={22} color={Colors.asphalt}/></Pressable>
          </View>

          <View style={styles.searchRow}>
            <Search size={18} color={Colors.warmGray} />
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search emoji"
              accessibilityLabel="Search emoji"
              placeholderTextColor={Colors.warmGray}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          <FlashList
            key={`${activeSlug}:${query ? 'q' : 'cat'}:${numColumns}`}
            data={emojiData}
            numColumns={numColumns}
            keyExtractor={(item, i) => `${item}:${i}`}
            renderItem={renderEmoji}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>{activeSlug === 'recent' && !query ? 'Your recent reactions will appear here.' : 'Try another emoji name.'}</Text>
            }
          />

          {!query && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catBar} contentContainerStyle={styles.categories} keyboardShouldPersistTaps="handled">
              {CATEGORY_TABS.map((t) => (
                <Pressable
                  key={t.slug}
                  style={[styles.cat, activeSlug === t.slug && styles.catActive]}
                  onPress={() => setActiveSlug(t.slug)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.slug.replace(/_/g, ' ')} emoji`}
                  accessibilityState={{ selected: activeSlug === t.slug }}
                >
                  <Text allowFontScaling={false} style={styles.catIcon}>{t.icon}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
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
    alignSelf: 'center',
    maxHeight: '100%',
    flexShrink: 1,
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
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, paddingRight: 8 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    minHeight: 44,
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
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  categories: { paddingHorizontal: 6, alignItems: 'center' },
  cat: {
    width: 44,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: Colors.cardBg,
  },
  catActive: { backgroundColor: Colors.inputBg, borderBottomColor: Colors.terracotta },
  catIcon: {
    fontSize: CATEGORY_ICON_FONT_SIZE,
  },
});
