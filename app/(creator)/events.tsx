/**
 * Creator mode: events. Slice 0 of the launch design pass (doc 43 track B):
 * SEGMENTED upcoming / drafts / templates / past (the house underline-tab
 * pattern; Liz confirms the segmented call at her review), poster-led cards
 * with the text in its own zone (never over the image), warm header,
 * empty-state hints per segment. Data unchanged: owner-read RLS list plus
 * the batch-15 operator RPCs; tap to manage, "put it on again" only on
 * completed/cancelled.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents, type CommunityEventRow } from '../../lib/creatorMode';
import { deleteEventTemplate, listEventTemplates } from '../../lib/creatorEvents';
import { formatEventDateLA } from '../../lib/laDate';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';

type Segment = 'upcoming' | 'drafts' | 'templates' | 'past';

const SEGMENTS: { key: Segment; label: string }[] = [
  // LIZ COPY: segment labels
  { key: 'upcoming', label: 'upcoming' },
  { key: 'drafts', label: 'drafts' },
  { key: 'templates', label: 'templates' },
  { key: 'past', label: 'past' },
];

// LIZ COPY: the per-segment empty states, invitations not absences
const EMPTY_HINTS: Record<Segment, string> = {
  upcoming: 'nothing on the calendar yet. put one on and it lives here.',
  drafts: 'events you save before publishing land here. only you see them.',
  templates: 'save any event as a template and it lives here, ready to put on again.',
  past: 'completed and cancelled events settle here.',
};

function PosterThumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (imageUrl && !broken) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.thumb}
        contentFit="cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Text style={styles.thumbLetter}>{title.slice(0, 1).toLowerCase()}</Text>
    </View>
  );
}

export default function CreatorEventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('upcoming');
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const { data: events = [], refetch, isRefetching } = useQuery({
    queryKey: ['creator-events-tab', access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents((access?.ledCommunities ?? []).map((c) => c.id), user.id);
    },
    enabled: access != null,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['event-templates'],
    queryFn: listEventTemplates,
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => deleteEventTemplate(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['event-templates'] }),
  });

  const upcoming = events.filter((e) => e.status === 'Live');
  const drafts = events.filter((e) => e.status === 'Draft');
  const past = events.filter((e) => e.status !== 'Live' && e.status !== 'Draft');

  const renderEventCard = (e: CommunityEventRow, opts?: { past?: boolean; draft?: boolean }) => (
    <TouchableOpacity
      key={e.id}
      style={[styles.card, opts?.past && styles.cardPast]}
      onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
      activeOpacity={0.85}
    >
      <PosterThumb imageUrl={e.image_url} title={e.title} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {opts?.draft
            ? /* LIZ COPY */ `only you see it${e.event_date ? `  ${formatEventDateLA(e.event_date)}` : ''}`
            : opts?.past
              ? `${e.status.toLowerCase()}${e.event_date ? `  ${formatEventDateLA(e.event_date)}` : ''}`
              : [formatEventDateLA(e.event_date ?? ''), e.venue].filter(Boolean).join('  ')}
        </Text>
        {!!e.public_name && !opts?.draft && (
          <Text style={styles.cardByline} numberOfLines={1}>put on by {e.public_name}</Text>
        )}
        {opts?.past ? (
          <TouchableOpacity
            onPress={() => router.push(`/creator/event-form?duplicateFrom=${e.id}` as never)}
            hitSlop={8}
          >
            {/* LIZ COPY: duplicate = same event, fresh date */}
            <Text style={styles.cardAction}>put it on again</Text>
          </TouchableOpacity>
        ) : (
          /* LIZ COPY */
          <Text style={styles.cardActionQuiet}>{opts?.draft ? 'keep shaping it' : 'manage'}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const segmentBody = () => {
    switch (segment) {
      case 'upcoming':
        return upcoming.length > 0
          ? upcoming.map((e) => renderEventCard(e))
          : <Text style={styles.empty}>{EMPTY_HINTS.upcoming}</Text>;
      case 'drafts':
        return drafts.length > 0
          ? drafts.map((e) => renderEventCard(e, { draft: true }))
          : <Text style={styles.empty}>{EMPTY_HINTS.drafts}</Text>;
      case 'past':
        return past.length > 0
          ? past.map((e) => renderEventCard(e, { past: true }))
          : <Text style={styles.empty}>{EMPTY_HINTS.past}</Text>;
      case 'templates':
        return templates.length > 0 ? (
          templates.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.card}
              onPress={() => router.push(`/creator/event-form?templateId=${t.id}` as never)}
              activeOpacity={0.85}
            >
              <PosterThumb imageUrl={t.fields.image_url || null} title={t.name} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>{t.name}</Text>
                {/* LIZ COPY */}
                <Text style={styles.cardMeta}>tap to put it on</Text>
              </View>
              <TouchableOpacity onPress={() => removeTemplate.mutate(t.id)} hitSlop={10}>
                <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.empty}>{EMPTY_HINTS.templates}</Text>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>events</Text>

        <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/creator/event-form')}>
          <Plus size={16} color={Colors.white} strokeWidth={2.5} />
          <Text style={styles.postBtnText}>put on an event</Text>
        </TouchableOpacity>

        {/* the house underline-tab pattern, full width */}
        <View style={styles.segmentRow}>
          {SEGMENTS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={styles.segment}
              onPress={() => { hapticLight(); setSegment(s.key); }}
            >
              <Text style={[styles.segmentText, segment === s.key && styles.segmentTextOn]}>
                {s.label}
              </Text>
              <View style={[styles.segmentUnderline, segment === s.key && styles.segmentUnderlineOn]} />
            </TouchableOpacity>
          ))}
        </View>

        {segmentBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const THUMB_SIZE = 64;
const UNDERLINE_HEIGHT = 2.5;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 10 },
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    marginBottom: 4,
  },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  segmentRow: { flexDirection: 'row', marginBottom: 6 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  segmentText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  segmentTextOn: { color: Colors.darkWarm, fontFamily: Fonts.sansBold },
  segmentUnderline: { height: UNDERLINE_HEIGHT, alignSelf: 'stretch', marginTop: 6, backgroundColor: 'transparent' },
  segmentUnderlineOn: { backgroundColor: Colors.terracotta },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  cardPast: { opacity: 0.7 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12 },
  thumbFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  cardBody: { flex: 1 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 2 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  cardByline: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 2 },
  cardAction: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 6,
  },
  cardActionQuiet: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 6,
  },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 8 },
});
