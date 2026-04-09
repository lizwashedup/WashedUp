import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Instagram, Pen, Share2 } from 'lucide-react-native';
import { hapticLight, hapticMedium, hapticSuccess } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

interface Props {
  userId: string;
}

interface Moment {
  moment_id: string;
  event_id: string;
  user_id: string;
  content: string;
  created_at: string;
  is_public: boolean;
  writer_name: string | null;
  writer_photo: string | null;
  plan_title: string | null;
  plan_date: string | null;
}

interface UnwrittenPlan {
  id: string;
  title: string;
  start_time: string;
}

const momentPrompts = [
  'the best part was...',
  'i almost didn\'t go, but...',
  'something i didn\'t expect...',
  'the moment i knew it was going to be good...',
  'if i had to describe the vibe in three words...',
  'next time, i want to...',
  'the person who surprised me most...',
  'i keep thinking about...',
];

export default function MomentsTab({ userId }: Props) {
  const queryClient = useQueryClient();
  const [momentText, setMomentText] = useState('');
  const [writingForPlan, setWritingForPlan] = useState<UnwrittenPlan | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [placeholder] = useState(() => momentPrompts[Math.floor(Math.random() * momentPrompts.length)]);

  // Fetch all moments the user can see
  const { data: moments = [], isLoading } = useQuery({
    queryKey: ['user-moments', userId],
    queryFn: async (): Promise<Moment[]> => {
      const { data, error } = await supabase.rpc('get_user_moments', { p_user_id: userId });
      if (error) { console.warn('[WashedUp] get_user_moments failed:', error); return []; }
      return (data ?? []) as Moment[];
    },
    enabled: !!userId,
  });

  // Find recently completed plans where the user hasn't written a moment yet
  const { data: unwrittenPlans = [] } = useQuery({
    queryKey: ['unwritten-moments', userId],
    queryFn: async (): Promise<UnwrittenPlan[]> => {
      // Get events user attended
      const { data: memberships } = await supabase
        .from('event_members')
        .select('event_id, events (id, title, start_time, status)')
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (!memberships?.length) return [];

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentPast = memberships
        .map((m: any) => m.events)
        .filter((e: any) => {
          if (!e) return false;
          const start = new Date(e.start_time);
          return start < now && start > sevenDaysAgo && e.status !== 'cancelled';
        });

      if (!recentPast.length) return [];

      // Check which ones already have a moment from this user
      const eventIds = recentPast.map((e: any) => e.id);
      const { data: existing } = await supabase
        .from('plan_moments')
        .select('event_id')
        .eq('user_id', userId)
        .in('event_id', eventIds);

      const writtenIds = new Set((existing ?? []).map((r: any) => r.event_id));

      // Check no-show status
      const { data: noShows } = await supabase
        .from('plan_attendance')
        .select('event_id')
        .in('event_id', eventIds)
        .eq('user_id', userId)
        .eq('was_present', false);

      const noShowIds = new Set((noShows ?? []).map((r: any) => r.event_id));

      return recentPast
        .filter((e: any) => !writtenIds.has(e.id) && !noShowIds.has(e.id))
        .sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
        .map((e: any) => ({ id: e.id, title: e.title, start_time: e.start_time }));
    },
    enabled: !!userId,
  });

  const promptPlan = writingForPlan ?? (unwrittenPlans.length > 0 ? unwrittenPlans[0] : null);

  const submitMoment = useCallback(async () => {
    if (!promptPlan || !momentText.trim() || submitting) return;
    setSubmitting(true);
    hapticMedium();

    try {
      const { error } = await supabase.from('plan_moments').insert({
        event_id: promptPlan.id,
        user_id: userId,
        content: momentText.trim(),
        is_public: true,
      });

      if (error) throw error;

      hapticSuccess();
      setMomentText('');
      setWritingForPlan(null);
      queryClient.invalidateQueries({ queryKey: ['user-moments', userId] });
      queryClient.invalidateQueries({ queryKey: ['unwritten-moments', userId] });
    } catch (err) {
      console.warn('[WashedUp] Failed to save moment:', err);
    } finally {
      setSubmitting(false);
    }
  }, [promptPlan, momentText, submitting, userId, queryClient]);

  const getMomentUrl = useCallback((momentId: string) => {
    return `https://washedup.app/m/${momentId}`;
  }, []);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const copyLink = useCallback((momentId: string) => {
    hapticLight();
    Clipboard.setStringAsync(getMomentUrl(momentId));
    setCopiedId(momentId);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  }, [getMomentUrl]);

  const shareToIg = useCallback((moment: Moment) => {
    hapticLight();
    const url = getMomentUrl(moment.moment_id);
    // Open Instagram with the link — user can paste into story
    Clipboard.setStringAsync(url);
    Linking.openURL('instagram://story-camera').catch(() => {
      Linking.openURL('https://instagram.com').catch(() => {});
    });
  }, [getMomentUrl]);

  const formatDate = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Prompt card for unwritten moment */}
      {promptPlan && (
        <View style={styles.promptCard}>
          <View style={styles.promptHeader}>
            <Pen size={16} color={Colors.goldAccent} />
            <Text style={styles.promptTitle} numberOfLines={2}>so. how was {promptPlan.title}</Text>
          </View>
          <TextInput
            style={styles.promptInput}
            placeholder={placeholder}
            placeholderTextColor={Colors.warmGray}
            value={momentText}
            onChangeText={setMomentText}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />
          <View style={styles.promptFooter}>
            <Text style={styles.charCount}>{momentText.length}/500</Text>
            <TouchableOpacity
              style={[styles.submitBtn, (!momentText.trim() || submitting) && styles.submitBtnDisabled]}
              onPress={submitMoment}
              disabled={!momentText.trim() || submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.submitBtnText}>Share moment</Text>
              )}
            </TouchableOpacity>
          </View>
          {unwrittenPlans.length > 1 && !writingForPlan && (
            <View style={styles.otherPlans}>
              {unwrittenPlans.slice(1, 3).map(plan => (
                <TouchableOpacity
                  key={plan.id}
                  style={styles.otherPlanChip}
                  onPress={() => { hapticLight(); setWritingForPlan(plan); setMomentText(''); }}
                >
                  <Text style={styles.otherPlanText} numberOfLines={1}>{plan.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Moments feed */}
      {moments.length === 0 && !promptPlan ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyGlow} />
          <Pen size={36} color={Colors.terracotta} />
          <Text style={styles.emptyTitle}>your stories will show up here</Text>
          <Text style={styles.emptySubtitle}>write one after your next plan and share it anywhere</Text>
        </View>
      ) : (
        moments.map((moment) => {
          const firstName = moment.writer_name?.split(' ')[0] ?? 'Someone';
          const isOwn = moment.user_id === userId;

          return (
            <View key={moment.moment_id} style={styles.momentCard}>
              <View style={styles.momentHeader}>
                {moment.writer_photo ? (
                  <Image source={{ uri: moment.writer_photo }} style={styles.momentAvatar} contentFit="cover" />
                ) : (
                  <View style={[styles.momentAvatar, styles.momentAvatarFallback]}>
                    <Text style={styles.momentAvatarInitial}>{(firstName)[0].toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.momentWriter}>{isOwn ? 'You' : firstName}</Text>
                  <Text style={styles.momentPlan}>
                    {moment.plan_title}{moment.plan_date ? ` · ${formatDate(moment.plan_date)}` : ''}
                  </Text>
                </View>
              </View>

              <Text style={styles.momentContent}>"{moment.content}"</Text>

              <View style={styles.momentActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => shareToIg(moment)} activeOpacity={0.7}>
                  <Instagram size={14} color={Colors.terracotta} />
                  <Text style={styles.actionBtnText}>Share to IG</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => copyLink(moment.moment_id)} activeOpacity={0.7}>
                  <Copy size={14} color={Colors.terracotta} />
                  <Text style={styles.actionBtnText}>
                    {copiedId === moment.moment_id ? 'Copied!' : 'Copy link'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },

  // Prompt card
  promptCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(242,163,45,0.4)',
    shadowColor: Colors.goldAccent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  promptTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    flex: 1,
  },
  promptInput: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    padding: 14,
    minHeight: 80,
    lineHeight: 20,
  },
  promptFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  charCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
  },
  submitBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  otherPlans: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  otherPlanChip: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  otherPlanText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
  },

  // Empty state
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyGlow: { position: 'absolute', top: 80, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(242,163,45,0.04)', alignSelf: 'center' },
  emptyTitle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, textAlign: 'center', marginTop: 32 },
  emptySubtitle: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.warmGray, textAlign: 'center', marginTop: 6 },

  // Moment card
  momentCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#2C1810',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  momentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  momentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  momentAvatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  momentAvatarInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  momentWriter: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  momentPlan: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    marginTop: 1,
  },
  momentContent: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    fontStyle: 'italic',
    color: Colors.asphalt,
    lineHeight: 22,
    marginBottom: 12,
  },
  momentActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  actionBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
});
