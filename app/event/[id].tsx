import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Dimensions,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Share2, Heart, Calendar, MapPin, Ticket, Users, ChevronRight } from 'lucide-react-native';
import { ShareLinkModal } from '../../components/modals/ShareLinkModal';
import { supabase } from '../../lib/supabase';

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
  host_name: string | null;
  host_photo: string | null;
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
  const [showShareModal, setShowShareModal] = useState(false);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

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
        host_name: p.profiles?.first_name_display ?? null,
        host_photo: p.profiles?.profile_photo_url ?? null,
      }));
    },
    enabled: !!id,
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

  if (isLoading || !event) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      </View>
    );
  }

  const spotsInfo = (plan: LinkedPlan) => {
    if (plan.status === 'full') return 'Full';
    const left = plan.max_invites - plan.member_count;
    return `${left} ${left === 1 ? 'spot' : 'spots'} left`;
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          {event.image_url ? (
            <Image source={{ uri: event.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F0E6D3', alignItems: 'center', justifyContent: 'center' }]}>
              <Calendar size={48} color="#C4652A" />
            </View>
          )}

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, left: 16 }]}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color="#1A1A1A" strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, right: 60 }]}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                await Share.share({
                  message: `Check out "${event.title}" on WashedUp!\nhttps://washedup.app/event/${event.id}`,
                  title: 'Share this event',
                });
              } catch {}
            }}
          >
            <Share2 size={18} color="#1A1A1A" strokeWidth={2} />
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
              color={isWishlisted ? '#E53935' : '#1A1A1A'}
              fill={isWishlisted ? '#E53935' : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {event.category && (
            <View style={[styles.detailCategoryPill, { backgroundColor: '#C4652A' }]}>
              <Text style={styles.detailCategoryText}>{event.category}</Text>
            </View>
          )}

          <Text style={styles.title}>{event.title}</Text>

          <View style={styles.metaRow}>
            <Calendar size={16} color="#9B8B7A" strokeWidth={2} />
            <Text style={styles.metaText}>{formatFullDate(event.event_date, event.start_time)}</Text>
          </View>

          {event.venue && (
            <View style={styles.metaRow}>
              <MapPin size={16} color="#9B8B7A" strokeWidth={2} />
              <Text style={styles.metaText}>
                {event.venue}{event.venue_address ? ` · ${event.venue_address}` : ''}
              </Text>
            </View>
          )}

          {event.ticket_price && (
            <View style={styles.metaRow}>
              <Ticket size={16} color="#9B8B7A" strokeWidth={2} />
              <Text style={styles.metaText}>{event.ticket_price}</Text>
            </View>
          )}

          {event.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.descriptionText}>{event.description}</Text>
            </View>
          )}

          {event.external_url && (
            <TouchableOpacity
              style={styles.ticketLink}
              onPress={() => Linking.openURL(event.external_url!)}
            >
              <Text style={styles.ticketLinkText}>Get Tickets</Text>
              <ChevronRight size={16} color="#C4652A" strokeWidth={2} />
            </TouchableOpacity>
          )}

          <View style={styles.plansSection}>
            <View style={styles.plansSectionHeader}>
              <Users size={18} color="#1A1A1A" strokeWidth={2} />
              <Text style={styles.plansSectionTitle}>People Going With WashedUp</Text>
            </View>

            {linkedPlans.length === 0 ? (
              <Text style={styles.noPlansText}>No one has posted a plan yet. Be the first!</Text>
            ) : (
              linkedPlans.map(plan => (
                <TouchableOpacity
                  key={plan.id}
                  style={styles.planCard}
                  onPress={() => router.push(`/plan/${plan.id}`)}
                  activeOpacity={0.85}
                >
                  <View style={styles.planCardTop}>
                    {plan.host_photo ? (
                      <Image source={{ uri: plan.host_photo }} style={styles.planHostAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.planHostAvatar, { backgroundColor: '#F0E6D3', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#C4652A' }}>
                          {plan.host_name?.[0]?.toUpperCase() ?? '?'}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.planHostName}>{plan.host_name ?? 'Someone'}'s plan</Text>
                    {plan.primary_vibe && (
                      <View style={styles.planVibePill}>
                        <Text style={styles.planVibeText}>{plan.primary_vibe}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <View style={[
                      styles.planJoinBtn,
                      plan.status === 'full' && { backgroundColor: '#E5E5E5' }
                    ]}>
                      <Text style={[
                        styles.planJoinBtnText,
                        plan.status === 'full' && { color: '#999' }
                      ]}>
                        {plan.status === 'full' ? 'Full' : 'Join'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Text style={styles.planMeta}>{spotsInfo(plan)}</Text>
                </TouchableOpacity>
              ))
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroContainer: { width: SCREEN_WIDTH, height: 280, position: 'relative' },
  circleButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: { padding: 20, gap: 12 },
  detailCategoryPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailCategoryText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', textTransform: 'capitalize' },
  title: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#1A1A1A',
    lineHeight: 34,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 14, color: '#9B8B7A', flex: 1, lineHeight: 20 },
  descriptionSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0E6D3' },
  descriptionText: { fontSize: 15, color: '#666666', lineHeight: 22 },
  ticketLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8 },
  ticketLinkText: { fontSize: 15, fontWeight: '700', color: '#C4652A' },
  plansSection: { marginTop: 16, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#F0E6D3', gap: 12 },
  plansSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plansSectionTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  noPlansText: { fontSize: 14, color: '#9B8B7A', fontStyle: 'italic' },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#F0E6D3',
  },
  planCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planHostAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  planHostName: { fontSize: 13, fontWeight: '600', color: '#1A1A1A' },
  planVibePill: { backgroundColor: '#F0E6D3', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  planVibeText: { fontSize: 10, fontWeight: '600', color: '#9B8B7A', textTransform: 'capitalize' },
  planJoinBtn: { backgroundColor: '#C4652A', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  planJoinBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  planTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  planMeta: { fontSize: 12, color: '#9B8B7A' },
  stickyBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFF8F0',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
  },
  postPlanButton: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  postPlanButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
