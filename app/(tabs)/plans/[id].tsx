// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/(tabs)/plans/[id].tsx
// INSTRUCTIONS: Replace the ENTIRE contents of this file with everything below.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Heart,
  Share2,
  MessageCircle,
  Clock,
  Lock,
  ChevronRight,
  UserPlus,
} from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanDetail {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  location_text: string | null;
  image_url: string | null;
  category: string | null;
  gender_preference: string | null;
  max_invites: number | null;
  min_invites: number | null;
  status: string;
  host_id: string;
  host: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
    bio: string | null;
  } | null;
  member_count: number;
}

interface Member {
  id: string;
  user_id: string;
  first_name: string | null;
  avatar_url: string | null;
  joined_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFullDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatGender(gender: string | null): string {
  if (!gender || gender === 'mixed') return 'Everyone Welcome';
  if (gender === 'women_only') return 'Women Only';
  if (gender === 'men_only') return 'Men Only';
  return 'Everyone Welcome';
}

function getGenderColor(gender: string | null): string {
  if (gender === 'women_only') return '#BF5C7C';
  if (gender === 'men_only') return '#5C7CBF';
  return '#5CBF7C';
}

function getCategoryEmoji(category: string | null): string {
  const map: Record<string, string> = {
    food: '🍜', music: '🎵', nightlife: '🌙', outdoors: '🌿',
    fitness: '💪', film: '🎬', art: '🎨', comedy: '😂',
    sports: '⚽', wellness: '🧘',
  };
  return category ? (map[category.toLowerCase()] ?? '✨') : '✨';
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchPlanDetail(id: string): Promise<PlanDetail> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, title, description, start_time, location_text,
      image_url, category, gender_preference, max_invites,
      min_invites, status, host_id,
      host:profiles!events_host_id_fkey(id, first_name, avatar_url, bio),
      event_members(count)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  return {
    ...data,
    member_count: (data as any).event_members?.[0]?.count ?? 0,
    host: Array.isArray((data as any).host)
      ? (data as any).host[0] ?? null
      : (data as any).host ?? null,
  };
}

async function fetchMembers(planId: string): Promise<Member[]> {
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_event_members_reveal', { event_id: planId });

  if (!rpcError && rpcData) return rpcData as Member[];

  const { data, error } = await supabase
    .from('event_members')
    .select(`
      id, user_id, joined_at,
      profiles!event_members_user_id_fkey(first_name, avatar_url)
    `)
    .eq('event_id', planId)
    .eq('status', 'joined')
    .order('joined_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    joined_at: m.joined_at,
    first_name: Array.isArray(m.profiles) ? m.profiles[0]?.first_name : m.profiles?.first_name,
    avatar_url: Array.isArray(m.profiles) ? m.profiles[0]?.avatar_url : m.profiles?.avatar_url,
  }));
}

// ─── Member Avatar ────────────────────────────────────────────────────────────

const MemberAvatar = React.memo(({ member }: { member: Member }) => (
  <View style={styles.memberAvatarWrapper}>
    {member.avatar_url ? (
      <Image
        source={{ uri: member.avatar_url }}
        style={styles.memberAvatar}
        contentFit="cover"
      />
    ) : (
      <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
        <Text style={styles.memberAvatarInitial}>
          {member.first_name?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
    )}
    <Text style={styles.memberName} numberOfLines={1}>
      {member.first_name ?? 'Someone'}
    </Text>
  </View>
));

MemberAvatar.displayName = 'MemberAvatar';

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [isWishlisted, setIsWishlisted] = useState(false);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const { data: plan, isLoading: planLoading, error: planError } = useQuery({
    queryKey: ['events', 'detail', id],
    queryFn: () => fetchPlanDetail(id!),
    enabled: !!id,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['events', 'members', id],
    queryFn: () => fetchMembers(id!),
    enabled: !!id,
  });

  // Check wishlist
  React.useEffect(() => {
    if (!currentUserId || !id) return;
    supabase
      .from('wishlists')
      .select('id')
      .eq('user_id', currentUserId)
      .eq('event_id', id)
      .maybeSingle()
      .then(({ data }) => setIsWishlisted(!!data));
  }, [currentUserId, id]);

  const isMember = members.some((m) => m.user_id === currentUserId);
  const isHost = plan?.host_id === currentUserId;
  const maxSpots = plan?.max_invites ?? 8;
  const isFull = plan ? (plan.member_count >= maxSpots) : false;
  const spotsLeft = plan ? (maxSpots - plan.member_count) : 0;

  // Join
  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('event_members')
        .insert({ event_id: id, user_id: currentUserId, status: 'joined' });
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
    },
    onError: (error: any) => {
      Alert.alert('Oops', error.message ?? 'Something went wrong. Try again.');
    },
  });

  // Leave
  const leaveMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('event_members')
        .delete()
        .eq('event_id', id)
        .eq('user_id', currentUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
    },
  });

  // Wishlist toggle
  const toggleWishlist = useCallback(async () => {
    if (!currentUserId || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsWishlisted((prev) => !prev);
    if (isWishlisted) {
      await supabase.from('wishlists').delete().eq('user_id', currentUserId).eq('event_id', id);
    } else {
      await supabase.from('wishlists').insert({ user_id: currentUserId, event_id: id });
    }
    queryClient.invalidateQueries({ queryKey: ['wishlists', currentUserId] });
  }, [currentUserId, id, isWishlisted, queryClient]);

  // Share
  const handleShare = useCallback(async () => {
    if (!plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `Join me for "${plan.title}" on WashedUp!\nwashedup.app/plan/${plan.id}`,
      url: `https://washedup.app/plan/${plan.id}`,
    });
  }, [plan]);

  const handleJoinLeave = useCallback(() => {
    if (isHost) return;
    if (isMember) {
      Alert.alert(
        'Leave this plan?',
        "You can always rejoin if there's still a spot.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => leaveMutation.mutate() },
        ]
      );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      joinMutation.mutate();
    }
  }, [isHost, isMember, joinMutation, leaveMutation]);

  // ─── Loading / Error ────────────────────────────────────────────────────────

  if (planLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      </SafeAreaView>
    );
  }

  if (planError || !plan) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn't load this plan.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={styles.linkText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 0 }}
      >
        {/* Hero */}
        <View style={styles.heroContainer}>
          {plan.image_url ? (
            <Image
              source={{ uri: plan.image_url }}
              style={styles.heroImage}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Text style={styles.heroEmoji}>{getCategoryEmoji(plan.category)}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={20} color="#1A1A1A" strokeWidth={2.5} />
          </TouchableOpacity>

          <View style={styles.heroActions}>
            <TouchableOpacity
              onPress={toggleWishlist}
              style={styles.heroActionButton}
              accessibilityLabel={isWishlisted ? "Remove from I'd Go" : "Add to I'd Go"}
            >
              <Heart
                size={18}
                color={isWishlisted ? '#E53935' : '#1A1A1A'}
                fill={isWishlisted ? '#E53935' : 'transparent'}
                strokeWidth={2}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.heroActionButton}
              accessibilityLabel="Share this plan"
            >
              <Share2 size={18} color="#1A1A1A" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>

          {/* Badges */}
          <View style={styles.badgeRow}>
            {plan.category && (
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>
                  {getCategoryEmoji(plan.category)} {plan.category}
                </Text>
              </View>
            )}
            <View style={[
              styles.genderBadge,
              { backgroundColor: getGenderColor(plan.gender_preference) + '20' },
            ]}>
              <Lock size={11} color={getGenderColor(plan.gender_preference)} strokeWidth={2} />
              <Text style={[
                styles.genderBadgeText,
                { color: getGenderColor(plan.gender_preference) },
              ]}>
                {formatGender(plan.gender_preference)}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.title}>{plan.title}</Text>

          {/* Details card */}
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Calendar size={16} color="#C4652A" strokeWidth={2} />
              </View>
              <View>
                <Text style={styles.detailPrimary}>{formatFullDate(plan.start_time)}</Text>
                <Text style={styles.detailSecondary}>{formatTime(plan.start_time)}</Text>
              </View>
            </View>

            {plan.location_text && (
              <View style={[styles.detailRow, styles.detailBorder]}>
                <View style={styles.detailIcon}>
                  <MapPin size={16} color="#C4652A" strokeWidth={2} />
                </View>
                <Text style={[styles.detailPrimary, { flex: 1 }]}>{plan.location_text}</Text>
                <ChevronRight size={16} color="#999999" strokeWidth={2} />
              </View>
            )}

            <View style={[styles.detailRow, styles.detailBorder]}>
              <View style={styles.detailIcon}>
                <Users size={16} color="#C4652A" strokeWidth={2} />
              </View>
              <View>
                <Text style={styles.detailPrimary}>
                  {plan.member_count} going
                  {plan.max_invites ? ` · ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` : ''}
                </Text>
                <Text style={styles.detailSecondary}>
                  Group of {plan.min_invites ?? 3}–{maxSpots}
                </Text>
              </View>
            </View>
          </View>

          {/* Description */}
          {plan.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About this plan</Text>
              <Text style={styles.description}>{plan.description}</Text>
            </View>
          )}

          {/* Host */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hosted by</Text>
            <View style={styles.hostCard}>
              {plan.host?.avatar_url ? (
                <Image
                  source={{ uri: plan.host.avatar_url }}
                  style={styles.hostAvatar}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
                  <Text style={styles.hostAvatarInitial}>
                    {plan.host?.first_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.hostName}>{plan.host?.first_name ?? 'Someone'}</Text>
                {plan.host?.bio && (
                  <Text style={styles.hostBio} numberOfLines={2}>{plan.host.bio}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Who's Going */}
          {members.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Who's going · {members.length}/{maxSpots}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
              >
                {members.map((member) => (
                  <MemberAvatar key={member.id} member={member} />
                ))}
                {Array.from({ length: Math.max(0, maxSpots - members.length) }).map((_, i) => (
                  <View key={`empty-${i}`} style={styles.memberAvatarWrapper}>
                    <View style={styles.emptySpot}>
                      <UserPlus size={18} color="#CCCCCC" strokeWidth={1.5} />
                    </View>
                    <Text style={[styles.memberName, { color: '#CCCCCC' }]}>Open</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Chat button — members only */}
          {(isMember || isHost) && (
            <TouchableOpacity
              style={styles.chatCard}
              onPress={() => router.push(`/(tabs)/chats/${plan.id}`)}
              accessibilityLabel="Open group chat"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MessageCircle size={20} color="#C4652A" strokeWidth={2} />
                <Text style={styles.chatCardText}>Group Chat</Text>
              </View>
              <ChevronRight size={18} color="#C4652A" strokeWidth={2} />
            </TouchableOpacity>
          )}

          <View style={{ height: 110 }} />
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      {!isHost && (
        <View style={styles.stickyBar}>
          {isFull && !isMember ? (
            <View style={styles.fullButton}>
              <Clock size={18} color="#999999" strokeWidth={2} />
              <Text style={styles.fullButtonText}>This plan is full</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.joinButton,
                isMember && styles.leaveButton,
                (joinMutation.isPending || leaveMutation.isPending) && { opacity: 0.6 },
              ]}
              onPress={handleJoinLeave}
              disabled={joinMutation.isPending || leaveMutation.isPending}
              accessibilityLabel={isMember ? 'Leave plan' : 'Join plan'}
            >
              {(joinMutation.isPending || leaveMutation.isPending) ? (
                <ActivityIndicator size="small" color={isMember ? '#999999' : '#FFFFFF'} />
              ) : (
                <Text style={[styles.joinButtonText, isMember && styles.leaveButtonText]}>
                  {isMember
                    ? 'Leave Plan'
                    : `Join · ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {isHost && (
        <View style={styles.stickyBar}>
          <View style={styles.hostBadge}>
            <Text style={styles.hostBadgeText}>
              ✓ Your Plan · {plan.member_count} joined
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#666666' },
  linkText: { fontSize: 15, color: '#C4652A', fontWeight: '600' },

  heroContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 0.65,
    position: 'relative',
  },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: { fontSize: 64 },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  heroActions: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  heroActionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },

  content: { padding: 20 },

  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  categoryBadge: {
    backgroundColor: '#F0E6D3',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontSize: 13,
    color: '#C4652A',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  genderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  genderBadgeText: { fontSize: 13, fontWeight: '600' },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1A1A',
    lineHeight: 32,
    marginBottom: 20,
    letterSpacing: -0.3,
  },

  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  detailBorder: { borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFF0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPrimary: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  detailSecondary: { fontSize: 13, color: '#999999', marginTop: 2 },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  description: { fontSize: 15, color: '#444444', lineHeight: 24 },

  hostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  hostAvatar: { width: 52, height: 52, borderRadius: 26 },
  hostAvatarPlaceholder: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostAvatarInitial: { fontSize: 20, fontWeight: '700', color: '#C4652A' },
  hostName: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  hostBio: { fontSize: 13, color: '#666666', marginTop: 3, lineHeight: 18 },

  memberAvatarWrapper: {
    alignItems: 'center',
    width: 64,
    marginRight: 4,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  memberAvatarPlaceholder: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: { fontSize: 16, fontWeight: '700', color: '#C4652A' },
  memberName: { fontSize: 11, color: '#666666', marginTop: 5, textAlign: 'center' },
  emptySpot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    borderStyle: 'dashed',
  },

  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF0E8',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  chatCardText: { fontSize: 15, fontWeight: '700', color: '#C4652A' },

  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 12,
    backgroundColor: '#FFF8F0',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
  },
  joinButton: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  joinButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  leaveButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    shadowOpacity: 0,
    elevation: 0,
  },
  leaveButtonText: { color: '#999999' },
  fullButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    paddingVertical: 16,
  },
  fullButtonText: { color: '#999999', fontSize: 16, fontWeight: '600' },
  hostBadge: {
    backgroundColor: '#F0E6D3',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  hostBadgeText: { fontSize: 15, fontWeight: '700', color: '#C4652A' },
});
