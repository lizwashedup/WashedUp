import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GiphyGridView, GiphyContent } from '@giphy/react-native-sdk';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import emojiByChar from 'unicode-emoji-json/data-by-emoji.json';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Combined media picker rendered INSIDE the keyboard-height panel substrate
// (not a modal), so the input bar stays visible. One smile-button entry point,
// two tabs (Emoji | GIFs), one shared search field — the WhatsApp/Telegram/Signal
// pattern. Emoji data is pure-JS (unicode-emoji-json); GIFs use the embeddable
// GiphyGridView (native dep). Skin tones deferred for v1.

const RECENTS_KEY = 'chat_emoji_recents';
const RECENTS_MAX = 24;
const EMOJI_FONT_SIZE = 30;
const COLUMN_TARGET_WIDTH = 44;
const SEARCH_RESULT_CAP = 200;
const TAB_ICON_FONT_SIZE = 22;
const GIF_SPAN_COUNT = 3;
const GIF_CELL_PADDING = 4;
const GIPHY_API_KEY = process.env.EXPO_PUBLIC_GIPHY_SDK_KEY;

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

type MediaTab = 'emoji' | 'gif';

interface MediaPanelProps {
  onSelect: (emoji: string) => void;
  onBackspace: () => void;
  onGifSelect: (url: string) => void;
  height: number;
  bottomInset: number;
}

export default function MediaPanel({ onSelect, onBackspace, onGifSelect, height, bottomInset }: MediaPanelProps) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<MediaTab>('emoji');
  const [activeSlug, setActiveSlug] = useState('smileys_emotion');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  // The SDK is configured at app boot (app/_layout.tsx). Without a key the GIF
  // tab shows a friendly message instead of crashing.
  const gifReady = !!GIPHY_API_KEY;

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

  const gifContent = useMemo(
    () => (query.trim() ? GiphyContent.search({ searchQuery: query.trim() }) : GiphyContent.trending({})),
    [query],
  );

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

  const handleGifMedia = useCallback(
    (e: { nativeEvent: { media?: any } }) => {
      const media = e.nativeEvent?.media;
      const url = media?.data?.images?.original?.url ?? media?.url;
      if (url) onGifSelect(url);
    },
    [onGifSelect],
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
    <View style={[styles.panel, { height, paddingBottom: bottomInset }]}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.warmGray} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'gif' ? 'Search GIFs' : 'Search emoji'}
          placeholderTextColor={Colors.warmGray}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {tab === 'emoji' && (
          <Pressable onPress={onBackspace} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete">
            <Ionicons name="backspace-outline" size={22} color={Colors.warmGray} />
          </Pressable>
        )}
      </View>

      <View style={styles.tabSwitch}>
        {(['emoji', 'gif'] as MediaTab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.switchBtn, tab === t && styles.switchBtnActive]}
            onPress={() => setTab(t)}
            accessibilityRole="button"
            accessibilityLabel={t === 'emoji' ? 'Emoji' : 'GIFs'}
          >
            <Text style={[styles.switchText, tab === t && styles.switchTextActive]}>{t === 'emoji' ? 'Emoji' : 'GIFs'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'emoji' ? (
        <FlashList
          data={emojiData}
          numColumns={numColumns}
          keyExtractor={(item) => item}
          renderItem={renderEmoji}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>{activeSlug === 'recent' && !query ? 'No recents yet' : 'No emoji found'}</Text>
          }
        />
      ) : gifReady ? (
        <GiphyGridView
          content={gifContent}
          cellPadding={GIF_CELL_PADDING}
          spanCount={GIF_SPAN_COUNT}
          style={styles.gifGrid}
          onMediaSelect={handleGifMedia}
        />
      ) : (
        <Text style={styles.empty}>GIFs are unavailable right now.</Text>
      )}

      {tab === 'emoji' && !query && (
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
  tabSwitch: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  switchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  switchBtnActive: {
    backgroundColor: Colors.brandSoft,
  },
  switchText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
  },
  switchTextActive: {
    color: Colors.terracotta,
  },
  gifGrid: {
    flex: 1,
    marginHorizontal: 8,
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
    fontSize: TAB_ICON_FONT_SIZE,
    opacity: 0.45,
  },
  catIconActive: {
    opacity: 1,
  },
});
