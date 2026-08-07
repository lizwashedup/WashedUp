/**
 * Dev-only chat list benchmark (doc 123 measurement harness). NOT part of any
 * user flow; __DEV__-gated like /dev/first-join.
 *
 * Renders the SAME 523-row synthetic fixture (520 messages + separators,
 * mirroring doc 106's fixture size) through two list implementations and
 * reports mount -> first-content-layout in ms, on screen and to the console:
 *
 *   /dev/chat-bench                 -> chooser
 *   /dev/chat-bench?impl=flatlist   -> inverted FlatList, the legacy
 *                                      ChatThread's exact list props
 *   /dev/chat-bench?impl=flashlist  -> FlashList v2, the engine's list props
 *
 * Both paths render the ENGINE's MessageBubble, so the list architecture is
 * the only variable. Fixture is generated in-memory: zero network, zero prod
 * reads or writes, no images (image bubbles are exercised in the real thread,
 * not here). Scroll smoothness is a manual check with the perf monitor; this
 * screen only times the cold-open layout number doc 106 measured.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import type { ChatMessage } from '../../hooks/useChat';
import {
  EngineMessageBubble,
  deriveMessageBits,
  buildEnrichedItems,
  EnrichedItem,
} from '../../components/chat-engine/ChatEngineThread';

const FIXTURE_COUNT = 520;
const ME = 'bench-user-me';
const OTHERS = ['bench-user-a', 'bench-user-b', 'bench-user-c'];
const NAMES: Record<string, string> = {
  'bench-user-a': 'Ada',
  'bench-user-b': 'Bo',
  'bench-user-c': 'Cy',
};
const PHRASES = [
  'ok so what time are we thinking',
  'i can do 7 but not earlier',
  'the one on 3rd street? that place is great',
  'https://washedup.app/plans this weekend anyone',
  'lol',
  'wait let me check something and get back to you, give me like twenty minutes because traffic is honestly unhinged right now',
  'sounds perfect, see everyone there',
  'who else is coming to this',
  'bringing snacks, any requests',
];
const EMOJI_ONLY = '\uD83D\uDE02\uD83D\uDE02';
// Fixed epoch so the fixture is identical run to run (spacing produces the
// same separator rows every time).
const FIXTURE_EPOCH_MS = 1754400000000;
const FIXTURE_STEP_MS = 4 * 60 * 1000;
const FIXTURE_TIME_JUMP_EVERY = 60;
const FIXTURE_TIME_JUMP_MS = 26 * 60 * 60 * 1000;

function buildFixture(): ChatMessage[] {
  const out: ChatMessage[] = [];
  let t = FIXTURE_EPOCH_MS;
  for (let i = 0; i < FIXTURE_COUNT; i++) {
    // Periodic >24h jumps so date separators appear like a real thread.
    if (i > 0 && i % FIXTURE_TIME_JUMP_EVERY === 0) t += FIXTURE_TIME_JUMP_MS;
    t += FIXTURE_STEP_MS;
    const own = i % 4 === 0;
    const userId = own ? ME : OTHERS[i % OTHERS.length];
    const emojiRow = i % 37 === 0;
    out.push({
      id: `bench-${i}`,
      circle_id: 'bench-circle',
      user_id: userId,
      content: emojiRow ? EMOJI_ONLY : PHRASES[i % PHRASES.length],
      message_type: 'user',
      created_at: new Date(t).toISOString(),
      reply_to_message_id: null,
      reply_to: i % 23 === 0 && i > 0
        ? { id: `bench-${i - 1}`, content: PHRASES[(i - 1) % PHRASES.length], sender_name: NAMES[OTHERS[(i - 1) % OTHERS.length]] ?? 'You' }
        : null,
      reactions: i % 11 === 0 ? [{ user_id: OTHERS[0], reaction: 'heart' }] : [],
      sender: own ? null : { id: userId, first_name: NAMES[userId], avatar_url: null },
    });
  }
  return out;
}

function useBenchRows() {
  return useMemo(() => {
    const messages = buildFixture();
    const chronological = buildEnrichedItems(messages);
    return { chronological, inverted: [...chronological].reverse() };
  }, []);
}

function BenchRow({ item }: { item: EnrichedItem }) {
  if ('type' in item && (item.type === 'date' || item.type === 'time')) {
    return (
      <View style={styles.sepRow}>
        <Text style={styles.sepText}>{item.label}</Text>
      </View>
    );
  }
  const msg = item as ChatMessage;
  const isOwn = msg.user_id === ME;
  return (
    <EngineMessageBubble
      message={msg}
      derived={deriveMessageBits(msg)}
      isOwn={isOwn}
      showAvatar={!isOwn}
      showName={!isOwn}
      isGrouped={false}
      currentUserId={ME}
    />
  );
}

function BenchList({ impl }: { impl: 'flatlist' | 'flashlist' }) {
  const { chronological, inverted } = useBenchRows();
  // Mount timestamp captured once, before the first render commits.
  const mountedAtRef = useRef<number>(performance.now());
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const reportedRef = useRef(false);

  const onFirstLayout = useCallback(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    const ms = Math.round(performance.now() - mountedAtRef.current);
    setLayoutMs(ms);
    console.log(`[chat-bench] ${impl} mount->first-layout: ${ms}ms (rows=${chronological.length}, ${Platform.OS})`);
  }, [impl, chronological.length]);

  const renderItem = useCallback(
    ({ item }: { item: EnrichedItem }) => <BenchRow item={item} />,
    [],
  );

  const getItemType = useCallback((item: EnrichedItem) => {
    if ('type' in item && (item.type === 'date' || item.type === 'time')) return 'sep';
    return (item as ChatMessage).user_id === ME ? 'own' : 'other';
  }, []);

  return (
    <View style={styles.listWrap}>
      <View style={styles.resultBar}>
        <Text style={styles.resultText}>
          {impl} · {layoutMs === null ? 'measuring...' : `${layoutMs}ms mount->layout`} · {chronological.length} rows
        </Text>
      </View>
      {impl === 'flatlist' ? (
        <FlatList
          data={inverted}
          keyExtractor={(item) => item.id}
          inverted={true}
          renderItem={renderItem}
          onLayout={onFirstLayout}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={20}
          windowSize={10}
          maxToRenderPerBatch={15}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          scrollEventThrottle={16}
        />
      ) : (
        <FlashList
          data={chronological}
          keyExtractor={(item) => item.id}
          getItemType={getItemType}
          renderItem={renderItem}
          onLayout={onFirstLayout}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        />
      )}
    </View>
  );
}

export default function ChatBenchScreen() {
  const { impl } = useLocalSearchParams<{ impl?: string }>();
  if (!__DEV__) return <Redirect href="/(tabs)/plans" />;

  if (impl === 'flatlist' || impl === 'flashlist') {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <BenchList impl={impl} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.chooser}>
        <Text style={styles.title}>chat list bench</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.push('/dev/chat-bench?impl=flatlist' as any)}>
          <Text style={styles.btnText}>FlatList (legacy)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => router.push('/dev/chat-bench?impl=flashlist' as any)}>
          <Text style={styles.btnText}>FlashList (engine)</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  chooser: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, marginBottom: 8 },
  btn: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  btnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  listWrap: { flex: 1 },
  resultBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  resultText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  sepRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  sepText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.tertiary,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
