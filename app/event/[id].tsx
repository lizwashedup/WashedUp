import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Dimensions,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Share2, Heart, Calendar, MapPin, Ticket, Users, ChevronRight, MoreHorizontal } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import Colors from '../../constants/Colors';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../constants/Typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ExploreEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  ticket_price: string | null;
}

interface LinkedPlan {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  member_count: number;
  max_invites: number;
  status: string;
  creator_user_id: string;
  creator_name: string | null;
  creator_photo: string | null;
  primary_vibe: string | null;
}

function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
}

function formatFullDate(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return '';
  const date = parseLocalDate(dateStr);
  const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (timeStr) {
    const [h, m] = timeStr.split(':');
    const d = new Date();
    d.setHours(parseInt(h, 10), parseInt(m, 10));
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayLabel} at ${t}`;
  }
  return dayLabel;
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const { blockUser } = useBlock();

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const handleCreatorMenu = useCallback((creatorId: string, creatorName: string) => {
    if (creatorId === userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      creatorName,
      undefined,
      [
        {
          text: `Report ${creatorName}`,
          onPress: () => {
            setReportTarget({ id: creatorId, name: creatorName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${creatorName}`,
          style: 'destructive',
          onPress: () => blockUser(creatorId, creatorName, () => {
            queryClient.invalidateQueries({ queryKey: ['event-plans', id] });
          }),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [userId, blockUser, queryClient, id]);

  const { data: event, isLoading } = useQuery({
    queryKey: ['explore-event', id],
    queryFn: async (): Promise<ExploreEvent | null> => {
      const { data, error } = await supabase
        .from('explore_events')
        .select('id, title, description, image_url, event_date, start_time, venue, venue_address, category, external_url, ticket_price')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: linkedPlans = [] } = useQuery({
    queryKey: ['event-plans', id],
    queryFn: async (): Promise<LinkedPlan[]> => {
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, title, start_time, location_text, member_count, max_invites, status,
          creator_user_id, primary_vibe,
          profiles!events_creator_user_id_fkey ( first_name_display, profile_photo_url )
        `)
        .eq('explore_event_id', id)
        .in('status', ['forming', 'active', 'full'])
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        creator_name: p.profiles?.first_name_display ?? null,
        creator_photo: p.profiles?.profile_photo_url ?? null,
      }));
    },
    enabled: !!id,
  });

  // Fetch actual member counts from event_members — member_count on events can be out of sync
  const planIdsKey = linkedPlans.map((p) => p.id).sort().join(',');
  const { data: memberCountsMap = {} } = useQuery({
    queryKey: ['event-plans-member-counts', planIdsKey],
    queryFn: async (): Promise<Record<string, number>> => {
      const planIds = linkedPlans.map((p) => p.id);
      if (planIds.length === 0) return {};
      const { data, error } = await supabase
        .from('event_members')
        .select('event_id')
        .in('event_id', planIds)
        .eq('status', 'joined');
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: { event_id: string }) => {
        counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      });
      return counts;
    },
    enabled: linkedPlans.length > 0,
  });

  const { data: isWishlisted = false } = useQuery({
    queryKey: ['explore-wishlist-check', id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('explore_wishlists')
        .select('id')
        .eq('user_id', userId!)
        .eq('explore_event_id', id!)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    enabled: !!userId && !!id,
  });

  const wishlistMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !id) return;
      if (isWishlisted) {
        await supabase.from('explore_wishlists').delete().eq('user_id', userId).eq('explore_event_id', id);
      } else {
        await supabase.from('explore_wishlists').insert({ user_id: userId, explore_event_id: id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['explore-wishlist-check', id] });
    },
  });

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#666', textAlign: 'center' }}>Event not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 }}>
            <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#fff' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isFree = !event.ticket_price || (typeof event.ticket_price === 'string' && (event.ticket_price.trim() === '' || event.ticket_price.trim().toLowerCase() === 'free'));

  const getPlanSpotsInfo = (plan: LinkedPlan): { text: string; isFull: boolean } => {
    const actualCount = memberCountsMap[plan.id] ?? plan.member_count;
    const capped = capDisplayCount(actualCount);
    const totalCapacity = Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
    const left = Math.max(0, totalCapacity - capped);
    const isFull = left === 0;
    const text = isFull ? 'Full' : `${left} ${left === 1 ? 'spot' : 'spots'} left`;
    return { text, isFull };
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          <Image
            source={event.image_url ? { uri: event.image_url } : require('../../assets/images/plan-placeholder.png')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, left: 16 }]}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, right: 60 }]}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                await Share.share({
                  message: `Check out "${event.title}" in LA on WashedUp!\nhttps://washedup.app/e/${event.id}`,
                  title: 'Share this event',
                });
              } catch {}
            }}
          >
            <Share2 size={18} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, right: 16 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              wishlistMutation.mutate();
            }}
          >
            <Heart
              size={18}
              color={isWishlisted ? Colors.errorRed : Colors.asphalt}
              fill={isWishlisted ? Colors.errorRed : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {event.category && (
            <View style={[styles.detailCategoryPill, { backgroundColor: Colors.terracotta }]}>
              <Text style={styles.detailCategoryText}>{event.category}</Text>
            </View>
          )}

          <Text style={styles.title}>{event.title}</Text>

          <View style={styles.metaRow}>
            <Calendar size={16} color={Colors.warmGray} strokeWidth={2} />
            <Text style={styles.metaText}>{formatFullDate(event.event_date, event.start_time)}</Text>
          </View>

          {event.venue && (
            <View style={styles.metaRow}>
              <MapPin size={16} color={Colors.warmGray} strokeWidth={2} />
              <Text style={styles.metaText}>
                {event.venue}{event.venue_address ? ` · ${event.venue_address}` : ''}
              </Text>
            </View>
          )}

          {event.ticket_price && (
            <View style={styles.metaRow}>
              <Ticket size={16} color={Colors.warmGray} strokeWidth={2} />
              <Text style={styles.metaText}>{event.ticket_price}</Text>
            </View>
          )}

          {event.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.descriptionText}>{event.description}</Text>
            </View>
          )}

          {!isFree && event.external_url && (
            <TouchableOpacity
              style={styles.ticketLink}
              onPress={() => openUrl(event.external_url!)}
            >
              <Text style={styles.ticketLinkText}>Get Tickets</Text>
              <ChevronRight size={16} color={Colors.terracotta} strokeWidth={2} />
            </TouchableOpacity>
          )}

          <View style={styles.plansSection}>
            <View style={styles.plansSectionHeader}>
              <Users size={18} color={Colors.asphalt} strokeWidth={2} />
              <Text style={styles.plansSectionTitle}>People Going With WashedUp</Text>
            </View>

            {linkedPlans.length === 0 ? (
              <Text style={styles.noPlansText}>No one has posted a plan yet. Be the first!</Text>
            ) : (
              linkedPlans.map(plan => {
                const { text: spotsText, isFull } = getPlanSpotsInfo(plan);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.planCard}
                    onPress={() => router.push(`/plan/${plan.id}`)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.planCardTop}>
                      {plan.creator_photo ? (
                        <Image source={{ uri: plan.creator_photo }} style={styles.planCreatorAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.planCreatorAvatar, styles.planCreatorAvatarFallback]}>
                          <Text style={styles.planCreatorInitial}>
                            {plan.creator_name?.[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.planCreatorName}>Posted by {plan.creator_name ?? 'Someone'}</Text>
                      {plan.primary_vibe && (
                        <View style={styles.planVibePill}>
                          <Text style={styles.planVibeText}>{plan.primary_vibe}</Text>
                        </View>
                      )}
                      <View style={styles.planCardSpacer} />
                      {plan.creator_user_id !== userId && (
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleCreatorMenu(plan.creator_user_id, plan.creator_name ?? 'this person');
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.planMenuBtn}
                        >
                          <MoreHorizontal size={16} color={Colors.textLight} />
                        </TouchableOpacity>
                      )}
                      <View style={[
                        styles.planJoinBtn,
                        isFull && styles.planJoinBtnFull,
                      ]}>
                        <Text style={[
                          styles.planJoinBtnText,
                          isFull && styles.planJoinBtnTextFull,
                        ]}>
                          {isFull ? 'Full' : 'Join'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <Text style={styles.planMeta}>{spotsText}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
          style={styles.postPlanButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push({
              pathname: '/(tabs)/post',
              params: {
                prefillTitle: event.title,
                prefillExploreEventId: event.id,
              },
            });
          }}
        >
          <Text style={styles.postPlanButtonText}>Find People to Go With</Text>
        </TouchableOpacity>
      </View>

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroContainer: { width: SCREEN_WIDTH, height: 280, position: 'relative' },
  circleButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlayWhite90,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: { padding: 20, gap: 12 },
  detailCategoryPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailCategoryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white, textTransform: 'capitalize' },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    lineHeight: 34,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, flex: 1, lineHeight: 20 },
  descriptionSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: Colors.inputBg },
  descriptionText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, lineHeight: 22 },
  ticketLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8 },
  ticketLinkText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  plansSection: { marginTop: 16, paddingTop: 20, borderTopWidth: 1, borderTopColor: Colors.inputBg, gap: 12 },
  plansSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plansSectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  noPlansText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, fontStyle: 'italic' },
  planCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.inputBg,
  },
  planCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCreatorAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  planCreatorAvatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center' as const, justifyContent: 'center' as const },
  planCreatorInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  planCreatorName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  planVibePill: { backgroundColor: Colors.inputBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  planVibeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.warmGray, textTransform: 'capitalize' },
  planCardSpacer: { flex: 1 },
  planMenuBtn: { padding: 4, marginRight: 4 },
  planJoinBtn: { backgroundColor: Colors.terracotta, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  planJoinBtnFull: { backgroundColor: Colors.border },
  planJoinBtnTextFull: { color: Colors.textLight },
  planJoinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  planTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  planMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.warmGray },
  stickyBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.parchment,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  postPlanButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  postPlanButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
