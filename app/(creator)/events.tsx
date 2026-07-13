/**
 * Creator mode: events. The list (owner-read RLS shows every status now)
 * plus post-an-event and tap-to-edit against the batch-15 operator RPCs.
 * Functionally minimal per decision 15a.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents } from '../../lib/creatorMode';
import { deleteEventTemplate, listEventTemplates } from '../../lib/creatorEvents';
import { formatEventDateLA } from '../../lib/laDate';
import { supabase } from '../../lib/supabase';

export default function CreatorEventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const live = events.filter((e) => e.status === 'Live');
  const drafts = events.filter((e) => e.status === 'Draft');
  const past = events.filter((e) => e.status !== 'Live' && e.status !== 'Draft');

  const { data: templates = [] } = useQuery({
    queryKey: ['event-templates'],
    queryFn: listEventTemplates,
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => deleteEventTemplate(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['event-templates'] }),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        <Text style={styles.title}>events</Text>

        <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/creator/event-form')}>
          <Plus size={16} color={Colors.white} strokeWidth={2.5} />
          <Text style={styles.postBtnText}>put on an event</Text>
        </TouchableOpacity>

        {/* drafts and templates keep a visible home even when empty, so
            "save it as a draft/template" has somewhere to point (doc 34 3.4) */}
        <Text style={styles.sectionLabel}>drafts</Text>
        {drafts.length === 0 && (
          /* LIZ COPY */
          <Text style={styles.sectionHint}>events you save before publishing land here. only you see them.</Text>
        )}
        {drafts.map((e) => (
          <TouchableOpacity
            key={e.id}
            style={styles.card}
            onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
          >
            <Text style={styles.cardTitle}>{e.title}</Text>
            {/* LIZ COPY */}
            <Text style={styles.cardMeta}>
              only you see it{e.event_date ? `  ${formatEventDateLA(e.event_date)}` : ''}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionLabel, styles.sectionGap]}>templates</Text>
        {templates.length === 0 && (
          /* LIZ COPY */
          <Text style={styles.sectionHint}>save any event as a template and it lives here, ready to put on again.</Text>
        )}
        {templates.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={styles.card}
            onPress={() => router.push(`/creator/event-form?templateId=${t.id}` as never)}
          >
            <View style={styles.templateRow}>
              <View style={styles.templateBody}>
                <Text style={styles.cardTitle}>{t.name}</Text>
                {/* LIZ COPY */}
                <Text style={styles.cardMeta}>tap to put it on</Text>
              </View>
              <TouchableOpacity onPress={() => removeTemplate.mutate(t.id)} hitSlop={10}>
                <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}

        {live.length > 0 && <Text style={[styles.sectionLabel, styles.sectionGap]}>live</Text>}
        {live.map((e) => (
          <TouchableOpacity
            key={e.id}
            style={styles.card}
            onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
          >
            <Text style={styles.cardTitle}>{e.title}</Text>
            <Text style={styles.cardMeta}>
              {[e.public_name, formatEventDateLA(e.event_date), e.venue].filter(Boolean).join('  ')}
            </Text>
            <TouchableOpacity
              onPress={() => router.push(`/creator/event-form?duplicateFrom=${e.id}` as never)}
              hitSlop={8}
            >
              {/* LIZ COPY: duplicate = same event, fresh date */}
              <Text style={styles.againLink}>put it on again</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {past.length > 0 && <Text style={[styles.sectionLabel, styles.sectionGap]}>past and cancelled</Text>}
        {past.map((e) => (
          <TouchableOpacity
            key={e.id}
            style={[styles.card, styles.cardPast]}
            onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
          >
            <Text style={styles.cardTitle}>{e.title}</Text>
            <Text style={styles.cardMeta}>
              {e.status.toLowerCase()}
              {e.event_date ? `  ${formatEventDateLA(e.event_date)}` : ''}
            </Text>
            <TouchableOpacity
              onPress={() => router.push(`/creator/event-form?duplicateFrom=${e.id}` as never)}
              hitSlop={8}
            >
              {/* LIZ COPY */}
              <Text style={styles.againLink}>put it on again</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {events.length === 0 && (
          <Text style={[styles.empty, styles.sectionGap]}>your first event goes here.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 10 },
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
    marginBottom: 6,
  },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  sectionGap: { marginTop: 12 },
  sectionHint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardPast: { opacity: 0.7 },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  templateBody: { flex: 1 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 3 },
  againLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 8,
  },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
});
