import React, { useState, useCallback, useEffect } from 'react';
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
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Heart,
  Share2,
  MessageCircle,
  ChevronRight,
} from 'lucide-react-native';
import { supabase } from '../../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * (9 / 16);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanDetail {
  id: string;
  title: string;
  description: string | null;
  host_message: string | null;
  start_time: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  image_url: string | null;
  primary_vibe: string | null;
  gender_rule: string | null;
  max_invites: number | null;
  min_invites: number | null;
  status: string;
  host_id: string;
  tickets_url: string | null;
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
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatGenderLabel(gender_rule: string | null): string | null {
  if (!gender_rule || gender_rule === 'mixed') return null;
  if (gender_rule === 'women_only') return 'Women Only';
  if (gender_rule === 'men_only') return 'Men Only';
  if (gender_rule === 'nonbinary_only') return 'Nonbinary Only';
  return null;
}

function getCategoryEmoji(category: string | null): string {
  const map: Record<string, string> = {
    food: '🍜', music: '🎵', nightlife: '🌙', outdoors: '🌿',
    fitness: '💪', film: '🎬', art: '🎨', comedy: '😂',
    sports: '⚽', wellness: '🧘',
  };
  return category ? (map[category.toLowerCase()] ?? '✨') : '✨';
}

function openDirections(locationText: string) {
  const encoded = encodeURIComponent(locationText);
  const url = Platform.OS === 'ios'
    ? `maps://?q=${encoded}`
    : `geo:0,0?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://maps.google.com/?q=${encoded}`);
  });
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchPlanDetail(id: string): Promise<PlanDetail> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, title, description, host_message, start_time,
      location_text, location_lat, location_lng,
      image_url, primary_vibe, gender_rule,
      max_invites, min_invites, status, member_count, creator_user_id,
      tickets_url
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  const row = data as any;

  // Fetch host via profiles_public view (bypasses profiles RLS for other users)
  let host: PlanDetail['host'] = null;
  if (row.creator_user_id) {
    const { data: profileRow } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url, bio')
      .eq('id', row.creator_user_id)
      .maybeSingle();

    if (profileRow) {
      host = {
        id: profileRow.id,
        first_name: profileRow.first_name_display ?? null,
        avatar_url: profileRow.profile_photo_url ?? null,
        bio: profileRow.bio ?? null,
      };
    }
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    host_message: row.host_message ?? null,
    start_time: row.start_time,
    location_text: row.location_text ?? null,
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    image_url: row.image_url ?? null,
    primary_vibe: row.primary_vibe ?? null,
    gender_rule: row.gender_rule ?? null,
    max_invites: row.max_invites ?? null,
    min_invites: row.min_invites ?? null,
    status: row.status,
    host_id: row.creator_user_id ?? null,
    tickets_url: row.tickets_url ?? null,
    member_count: row.member_count ?? 0,
    host,
  };
}

async function fetchMembers(planId: string): Promise<Member[]> {
  // Preferred path: RPC returns member profiles, requires caller to be a member
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_event_members_reveal', { event_id: planId });

  if (!rpcError && rpcData) return rpcData as Member[];

  // Fallback: get member user_ids, then query profiles_public view (no PII, publicly readable)
  const { data: memberRows, error: memberError } = await supabase
    .from('event_members')
    .select('id, user_id, joined_at')
    .eq('event_id', planId)
    .eq('status', 'joined')
    .order('joined_at', { ascending: true });

  if (memberError) throw memberError;
  if (!memberRows || memberRows.length === 0) return [];

  const userIds = memberRows.map((m: any) => m.user_id);

  const { data: profileRows } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds);

  const profileMap = new Map<string, any>(
    (profileRows ?? []).map((p: any) => [p.id, p]),
  );

  return memberRows.map((m: any) => {
    const profile = profileMap.get(m.user_id);
    return {
      id: m.id,
      user_id: m.user_id,
      joined_at: m.joined_at,
      first_name: profile?.first_name_display ?? null,
      avatar_url: profile?.profile_photo_url ?? null,
    };
  });
}

// ─── Member Avatar ────────────────────────────────────────────────────────────

const MemberAvatar = React.memo(({ member }: { member: Member }) => (
  <View style={styles.memberAvatarWrapper}>
    {member.avatar_url ? (
      <Image source={{ uri: member.avatar_url }} style={styles.memberAvatar} contentFit="cover" />
    ) : (
      <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
        <Text style={styles.memberAvatarInitial}>
          {member.first_name?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
    )}
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
  const [mapCoords, setMapCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
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

  // Resolve map coordinates — use stored coords, or geocode from location_text
  useEffect(() => {
    if (!plan) return;

    if (plan.location_lat != null && plan.location_lng != null) {
      setMapCoords({ latitude: plan.location_lat, longitude: plan.location_lng });
      return;
    }

    if (!plan.location_text) return;

    Location.geocodeAsync(plan.location_text)
      .then((results) => {
        if (results.length > 0) {
          setMapCoords({ latitude: results[0].latitude, longitude: results[0].longitude });
        }
      })
      .catch(() => {
        // geocoding unavailable, map won't show
      });
  }, [plan]);

  // Wishlist check
  useEffect(() => {
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
  const isFull = plan ? plan.member_count >= maxSpots : false;
  const spotsLeft = plan ? maxSpots - plan.member_count : 0;

  // ─── Join ────────────────────────────────────────────────────────────────────

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !id) throw new Error('Not authenticated');

      const { error: joinError } = await supabase
        .from('event_members')
        .insert({ event_id: id, user_id: currentUserId, role: 'guest', status: 'joined' });
      if (joinError) throw joinError;

      // System message
      await supabase.from('messages').insert({
        event_id: id,
        user_id: currentUserId,
        content: 'joined the plan',
        message_type: 'system',
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
    },
    onError: (error: any) => {
      Alert.alert('Oops', error.message ?? 'Something went wrong.');
    },
  });

  // ─── Wishlist ────────────────────────────────────────────────────────────────

  const toggleWishlist = useCallback(async () => {
    if (!currentUserId || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !isWishlisted;
    setIsWishlisted(next);
    if (!next) {
      await supabase.from('wishlists').delete().eq('user_id', currentUserId).eq('event_id', id);
    } else {
      await supabase.from('wishlists').insert({ user_id: currentUserId, event_id: id });
    }
    queryClient.invalidateQueries({ queryKey: ['wishlists', currentUserId] });
  }, [currentUserId, id, isWishlisted, queryClient]);

  // ─── Share ───────────────────────────────────────────────────────────────────

  const handleShare = useCallback(async () => {
    if (!plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `Join me for "${plan.title}" on WashedUp!\nhttps://washedup.app/plan/${plan.id}`,
    });
  }, [plan]);

  // ─── Loading / Error ─────────────────────────────────────────────────────────

  if (planLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      </SafeAreaView>
    );
  }

  if (planError || !plan) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn't load this plan.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={styles.linkText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const genderLabel = formatGenderLabel(plan.gender_rule);
  const visibleMembers = members.slice(0, 5);
  const overflowCount = members.length > 5 ? members.length - 5 : 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
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
              <Text style={styles.heroEmoji}>{getCategoryEmoji(plan.primary_vibe)}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.heroCircleButton}
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={20} color="#1A1A1A" strokeWidth={2.5} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleShare}
            style={[styles.heroCircleButton, styles.heroShareButton]}
            accessibilityLabel="Share this plan"
          >
            <Share2 size={18} color="#1A1A1A" strokeWidth={2} />
          </TouchableOpacity>

          {/* Photo overlay tags */}
          {genderLabel && (
            <View style={[styles.photoTag, styles.photoTagBottomLeft]}>
              <Text style={styles.photoTagText}>{genderLabel}</Text>
            </View>
          )}
          {plan.primary_vibe && (
            <View style={[styles.photoTag, styles.photoTagBottomRight]}>
              <Text style={styles.photoTagText}>{plan.primary_vibe}</Text>
            </View>
          )}
        </View>

        {/* Content card — overlaps photo */}
        <View style={styles.contentCard}>
          <Text style={styles.title}>{plan.title}</Text>

          {/* Date */}
          <View style={styles.detailRow}>
            <Calendar size={16} color="#C4652A" strokeWidth={2} />
            <Text style={styles.detailText}>
              {formatFullDate(plan.start_time)} · {formatTime(plan.start_time)}
            </Text>
          </View>

          {/* Location */}
          {plan.location_text && (
            <TouchableOpacity
              style={styles.detailRow}
              onPress={() => openDirections(plan.location_text!)}
              activeOpacity={0.7}
            >
              <MapPin size={16} color="#C4652A" strokeWidth={2} />
              <Text style={[styles.detailText, { flex: 1 }]}>{plan.location_text}</Text>
              <Text style={styles.directionsLink}>Get Directions</Text>
            </TouchableOpacity>
          )}

          {/* Static Map */}
          {mapCoords && (
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                region={{
                  latitude: mapCoords.latitude,
                  longitude: mapCoords.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                zoomEnabled={false}
                scrollEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                pointerEvents="none"
              >
                <Marker
                  coordinate={mapCoords}
                  pinColor="#C4652A"
                />
              </MapView>
            </View>
          )}

          {/* Host */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Posted by</Text>
            <View style={styles.hostRow}>
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
                {plan.description && (
                  <Text style={styles.hostMessage} numberOfLines={3}>{plan.description}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Who's going */}
          {members.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.whoGoingLabel}>
                <Text style={styles.whoGoingCount}>{plan.member_count} going</Text>
                {plan.max_invites ? (
                  <Text style={styles.whoGoingSpotsLeft}> · {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</Text>
                ) : null}
              </Text>
              <View style={styles.memberAvatarRow}>
                {visibleMembers.map((member) => (
                  <MemberAvatar key={member.id} member={member} />
                ))}
                {overflowCount > 0 && (
                  <View style={[styles.memberAvatar, styles.memberAvatarOverflow]}>
                    <Text style={styles.memberAvatarOverflowText}>+{overflowCount}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ─── Sticky Bottom Bar ─────────────────────────────────────────────────── */}

      <View style={styles.stickyBar}>
        {/* Get Tickets button — shown above the main action when tickets_url exists */}
        {plan.tickets_url && (
          <TouchableOpacity
            style={styles.ticketButton}
            onPress={() => Linking.openURL(plan.tickets_url!)}
            activeOpacity={0.85}
          >
            <Text style={styles.ticketButtonText}>Get Tickets →</Text>
          </TouchableOpacity>
        )}

        {isHost ? (
          <TouchableOpacity
            style={styles.manageButton}
            onPress={() => router.push(`/plan/${plan.id}/manage` as any)}
          >
            <Text style={styles.manageButtonText}>Manage Plan</Text>
          </TouchableOpacity>
        ) : isMember ? (
          <View style={styles.memberActions}>
            <View style={styles.youreGoingBadge}>
              <Text style={styles.youreGoingText}>You're going</Text>
            </View>
            <TouchableOpacity
              style={styles.openChatButton}
              onPress={() => router.push(`/(tabs)/chats/${plan.id}` as any)}
            >
              <MessageCircle size={18} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.openChatText}>Open Chat</Text>
            </TouchableOpacity>
          </View>
        ) : isFull ? (
          <TouchableOpacity style={styles.waitlistButton}>
            <Text style={styles.waitlistButtonText}>Join Waitlist</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.joinButton, joinMutation.isPending && { opacity: 0.6 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              joinMutation.mutate();
            }}
            disabled={joinMutation.isPending}
          >
            {joinMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.joinButtonText}>Join Plan</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
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
    height: HERO_HEIGHT,
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
  heroCircleButton: {
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
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  heroShareButton: {
    left: undefined,
    right: 16,
  },
  photoTag: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  photoTagBottomLeft: { bottom: 14, left: 14 },
  photoTagBottomRight: { bottom: 14, right: 14 },
  photoTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4652A',
    textTransform: 'capitalize',
  },

  contentCard: {
    marginTop: -20,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 28,
    flex: 1,
  },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1A1A',
    lineHeight: 32,
    letterSpacing: -0.3,
    marginBottom: 18,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  detailText: {
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  directionsLink: {
    fontSize: 14,
    color: '#C4652A',
    fontWeight: '600',
  },

  mapContainer: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
    marginTop: 4,
  },
  map: {
    flex: 1,
  },

  section: {
    marginTop: 8,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#999999',
    fontWeight: '500',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  hostAvatarPlaceholder: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostAvatarInitial: { fontSize: 16, fontWeight: '700', color: '#C4652A' },
  hostName: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 3 },
  hostMessage: { fontSize: 14, color: '#666666', lineHeight: 20 },

  whoGoingLabel: {
    marginBottom: 12,
  },
  whoGoingCount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#C4652A',
  },
  whoGoingSpotsLeft: {
    fontSize: 15,
    fontWeight: '500',
    color: '#999999',
  },
  memberAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: -8,
  },
  memberAvatarWrapper: {
    marginRight: -8,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  memberAvatarPlaceholder: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: { fontSize: 14, fontWeight: '700', color: '#C4652A' },
  memberAvatarOverflow: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarOverflowText: { fontSize: 12, fontWeight: '700', color: '#C4652A' },

  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0E6D3',
  },

  ticketButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  ticketButtonText: { color: '#C4652A', fontSize: 16, fontWeight: '700' },

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

  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  youreGoingBadge: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  youreGoingText: { fontSize: 16, fontWeight: '600', color: '#666666' },
  openChatButton: {
    flex: 1,
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  openChatText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  waitlistButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#C4652A',
  },
  waitlistButtonText: { fontSize: 17, fontWeight: '700', color: '#C4652A' },

  manageButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  manageButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
