import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, useWindowDimensions, Platform, ScrollView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GiphyGridView, GiphyContent } from './GiphyGrid';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import emojiByChar from 'unicode-emoji-json/data-by-emoji.json';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { LOCAL_DEVELOPMENT_ONLY } from '../../constants/LocalDevelopment';

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

/** Mirrors the existing native SDK bootstrap prerequisites. No provider calls. */
export function isChatGifPickerAvailable(): boolean {
  return !LOCAL_DEVELOPMENT_ONLY && !!GIPHY_API_KEY && (Platform.OS === 'ios' || Platform.OS === 'android');
}

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
  appearance?: { fonts: AfterglowFontFamilies };
  // Staged mobile uses the system emoji keyboard; GIFs retain this panel.
  mode?: 'emoji-gif' | 'gif-only';
}

export default function MediaPanel({ onSelect, onBackspace, onGifSelect, height, bottomInset, appearance, mode = 'emoji-gif' }: MediaPanelProps) {
  const { width } = useWindowDimensions();
  const staged = useMemo(() => appearance ? createMediaAppearance(appearance.fonts) : null, [appearance?.fonts]);
  const [selectedTab, setTab] = useState<MediaTab>('emoji');
  const emojiEnabled = mode !== 'gif-only';
  const tab = emojiEnabled ? selectedTab : 'gif';
  const [activeSlug, setActiveSlug] = useState('smileys_emotion');
  const [query, setQuery] = useState('');
  const searchInput = useRef<TextInput>(null);
  const [recents, setRecents] = useState<string[]>([]);
  // The SDK is configured at app boot (app/_layout.tsx). Without a key, or on
  // web (native-only SDK, GiphyGrid.web.ts stubs it out), the GIF tab shows a
  // friendly message instead of crashing.
  const gifReady = emojiEnabled ? !!GIPHY_API_KEY && Platform.OS !== 'web' : isChatGifPickerAvailable();

  useEffect(() => {
    if (!emojiEnabled) return;
    let active = true;
    AsyncStorage.getItem(RECENTS_KEY)
      .then((value) => {
        if (!active || !value) return;
        try {
          const parsed: unknown = JSON.parse(value);
          if (!Array.isArray(parsed)) return;
          const saved = parsed.filter((item): item is string => typeof item === 'string' && Object.prototype.hasOwnProperty.call(EMOJI_NAMES, item));
          // A person may already have picked an emoji while storage was loading.
          setRecents(current => {
            const next = [...new Set([...current, ...saved])].slice(0, RECENTS_MAX);
            // Preserve older recents on the next opening too, after an early pick.
            if (current.length) AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
            return next;
          });
        } catch { /* An invalid preference is not a failed chat. */ }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [emojiEnabled]);

  const numColumns = Math.max(6, Math.floor(width / COLUMN_TARGET_WIDTH));

  const groupBySlug = useMemo(() => {
    const m = new Map<string, Group>();
    GROUPS.forEach((g) => m.set(g.slug, g));
    return m;
  }, []);

  const emojiData: string[] = useMemo(() => {
    if (!emojiEnabled) return [];
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
  }, [query, activeSlug, recents, groupBySlug, emojiEnabled]);

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
      <Pressable style={styles.cell} onPress={() => handlePick(item)} accessibilityRole="button" accessibilityLabel={staged ? (EMOJI_NAMES[item]?.name || item) : item}>
        <Text style={styles.emoji}>{item}</Text>
      </Pressable>
    ),
    [handlePick, staged],
  );

  return (
    <View style={[styles.panel, staged?.panel, { height, paddingBottom: bottomInset }]}>
      <View style={[styles.searchRow, staged?.searchRow]}>
        <Ionicons name="search" size={16} color={staged ? AfterglowColors.muted : Colors.warmGray} />
        <TextInput
          ref={searchInput}
          style={[styles.search, staged?.search]}
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'gif' ? 'Search GIFs' : 'Search emoji'}
          placeholderTextColor={staged ? AfterglowColors.muted : Colors.warmGray}
          accessibilityLabel={tab === 'gif' ? 'Search GIFs' : 'Search emoji'}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {!!staged && !!query && <Pressable style={staged.utility} onPress={() => { setQuery(''); searchInput.current?.focus(); }} accessibilityRole="button" accessibilityLabel="Clear search"><Ionicons name="close" size={20} color={AfterglowColors.muted} /></Pressable>}
        {tab === 'emoji' && (
          <Pressable style={staged?.utility} onPress={onBackspace} hitSlop={8} accessibilityRole="button" accessibilityLabel={staged ? 'Delete from message' : 'Delete'}>
            <Ionicons name="backspace-outline" size={22} color={staged ? AfterglowColors.muted : Colors.warmGray} />
          </Pressable>
        )}
      </View>

      {emojiEnabled && <View style={[styles.tabSwitch, staged?.tabSwitch]}>
        {(['emoji', 'gif'] as MediaTab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.switchBtn, tab === t && styles.switchBtnActive, staged?.switchBtn, staged && tab === t && staged.switchBtnActive]}
            onPress={() => setTab(t)}
            accessibilityRole="button"
            accessibilityLabel={t === 'emoji' ? 'Emoji' : 'GIFs'}
            accessibilityState={staged ? { selected: tab === t } : undefined}
          >
            <Text style={[styles.switchText, tab === t && styles.switchTextActive, staged?.switchText, staged && tab === t && staged.switchTextActive]}>{t === 'emoji' ? 'Emoji' : 'GIFs'}</Text>
          </Pressable>
        ))}
      </View>}

      {tab === 'emoji' ? (
        <FlashList
          data={emojiData}
          numColumns={numColumns}
          keyExtractor={(item) => item}
          renderItem={renderEmoji}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[styles.empty, staged?.empty]}>{activeSlug === 'recent' && !query ? (staged ? 'Your recent emoji will appear here.' : 'No recents yet') : (staged ? 'Try another word to find an emoji.' : 'No emoji found')}</Text>
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
        <Text style={[styles.empty, staged?.empty]}>GIFs are unavailable right now.</Text>
      )}

      {tab === 'emoji' && !query && (
        staged ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={staged.categoryScroll} contentContainerStyle={staged.categoryContent} keyboardShouldPersistTaps="handled" accessibilityLabel="Emoji categories">
          {CATEGORY_TABS.map(t => <Pressable key={t.slug} style={[staged.category, activeSlug === t.slug && staged.categoryActive]} onPress={() => setActiveSlug(t.slug)} accessibilityRole="button" accessibilityLabel={`${t.slug.replace(/_/g, ' ')} emoji`} accessibilityState={{ selected: activeSlug === t.slug }}><Text style={[styles.catIcon, activeSlug === t.slug && styles.catIconActive]}>{t.icon}</Text></Pressable>)}
        </ScrollView> : <View style={styles.catBar}>
          {CATEGORY_TABS.map(t => <Pressable key={t.slug} style={styles.cat} onPress={() => setActiveSlug(t.slug)} accessibilityRole="button" accessibilityLabel={`${t.slug.replace(/_/g, ' ')} emoji`}><Text style={[styles.catIcon, activeSlug === t.slug && styles.catIconActive]}>{t.icon}</Text></Pressable>)}
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

/** Presentation only: retain media sources, recent preferences and picker actions. */
function createMediaAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    panel: { backgroundColor: AfterglowColors.paper, borderTopColor: AfterglowColors.subtleLine },
    searchRow: { borderRadius: 6, backgroundColor: AfterglowColors.white, paddingVertical: 0, paddingRight: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: AfterglowColors.line, gap: 4 },
    search: { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, minWidth: 0, minHeight: 44 },
    utility: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    tabSwitch: { gap: 16, paddingVertical: 0 },
    switchBtn: { minHeight: 44, minWidth: 64, borderRadius: 0, backgroundColor: AfterglowColors.paper, paddingHorizontal: 8, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: AfterglowColors.paper },
    switchBtnActive: { borderBottomColor: AfterglowColors.clay },
    switchText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
    switchTextActive: { color: AfterglowColors.ink },
    empty: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingHorizontal: 20 },
    categoryScroll: { flexGrow: 0, flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.subtleLine },
    categoryContent: { paddingHorizontal: 8 },
    category: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: 2, borderTopColor: AfterglowColors.paper },
    categoryActive: { borderTopColor: AfterglowColors.clay },
  });
}
