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
  Modal,
  TextInput,
  Pressable,
  Keyboard,
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
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { supabase } from '../../lib/supabase';

const GOOGLE_MAPS_API_KEY = 'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * (9 / 16);

const MANAGE_CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;

const MANAGE_GENDER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Mixed', value: 'mixed' },
  { label: 'Women Only', value: 'women_only' },
  { label: 'Men Only', value: 'men_only' },
  { label: 'Nonbinary Only', value: 'nonbinary_only' },
];

const MIN_GROUP = 3;
const MAX_GROUP = 8;

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

  const profileMap: Record<string, any> = {};
  (profileRows ?? []).forEach((p: any) => { profileMap[p.id] = p; });

  return memberRows.map((m: any) => {
    const profile = profileMap[m.user_id];
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
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinConfirmed, setJoinConfirmed] = useState(false);
  const [ticketModalVisible, setTicketModalVisible] = useState(false);
  const [manageModalVisible, setManageModalVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editHostMessage, setEditHostMessage] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLocationLat, setEditLocationLat] = useState<number | null>(null);
  const [editLocationLng, setEditLocationLng] = useState<number | null>(null);
  const [editTicketUrl, setEditTicketUrl] = useState('');
  const managePlacesRef = React.useRef<GooglePlacesAutocompleteRef>(null);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [editGenderRule, setEditGenderRule] = useState('mixed');
  const [editGroupSize, setEditGroupSize] = useState(6);
  const [editSaving, setEditSaving] = useState(false);

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
    mutationFn: async (greeting?: string) => {
      if (!currentUserId || !id) throw new Error('Not authenticated');

      // Check if there's an existing row (user previously left or partial insert)
      const { data: existing } = await supabase
        .from('event_members')
        .select('id')
        .eq('event_id', id)
        .eq('user_id', currentUserId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('event_members')
          .update({ status: 'joined', role: 'guest' })
          .eq('event_id', id)
          .eq('user_id', currentUserId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('event_members')
          .insert({ event_id: id, user_id: currentUserId, role: 'guest', status: 'joined' });
        if (insertError) throw insertError;
      }

      await supabase.from('messages').insert({
        event_id: id,
        user_id: currentUserId,
        content: 'joined the plan',
        message_type: 'system',
      });

      if (greeting && greeting.trim().length > 0) {
        await supabase.from('messages').insert({
          event_id: id,
          user_id: currentUserId,
          content: greeting.trim(),
          message_type: 'user',
        });
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJoinModalVisible(false);
      setJoinMessage('');
      setJoinConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-plans'] });
      queryClient.invalidateQueries({ queryKey: ['wishlists'] });

      // Navigate to chat so the user sees their greeting posted
      router.push(`/(tabs)/chats/${id}` as any);

      // If the event is ticketed, show the ticket prompt after a short delay
      if (plan?.tickets_url) {
        setTimeout(() => setTicketModalVisible(true), 600);
      }
    },
    onError: (error: any) => {
      Alert.alert('Oops', error.message ?? 'Something went wrong.');
    },
  });

  // ─── Leave ───────────────────────────────────────────────────────────────────

  const leaveMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId || !id) throw new Error('Not authenticated');

      await supabase
        .from('event_members')
        .update({ status: 'left' })
        .eq('event_id', id)
        .eq('user_id', currentUserId);

      await supabase.from('messages').insert({
        event_id: id,
        user_id: currentUserId,
        content: 'had to leave the plan',
        message_type: 'system',
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      queryClient.invalidateQueries({ queryKey: ['events', 'members', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
    },
    onError: (error: any) => {
      Alert.alert('Oops', error.message ?? 'Something went wrong.');
    },
  });

  const handleLeave = () => {
    Alert.alert(
      "Can't make it?",
      'Your spot will open for someone else. The group will be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave Plan',
          style: 'destructive',
          onPress: () => leaveMutation.mutate(),
        },
      ],
    );
  };

  // ─── Manage Plan ─────────────────────────────────────────────────────────────

  const openManageModal = () => {
    if (!plan) return;
    setEditTitle(plan.title);
    setEditDescription(plan.description ?? '');
    setEditHostMessage(plan.host_message ?? '');
    setEditLocation(plan.location_text ?? '');
    setEditLocationLat(plan.location_lat ?? null);
    setEditLocationLng(plan.location_lng ?? null);
    setEditTicketUrl(plan.tickets_url ?? '');
    setTimeout(() => {
      managePlacesRef.current?.setAddressText(plan.location_text ?? '');
    }, 100);
    setEditCategory(plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null);
    setEditGenderRule(plan.gender_rule ?? 'mixed');
    setEditGroupSize(plan.max_invites ?? 6);
    setManageModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!plan || !currentUserId || editSaving) return;
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          host_message: editHostMessage.trim() || null,
          location_text: editLocation.trim() || null,
          location_lat: editLocationLat,
          location_lng: editLocationLng,
          tickets_url: editTicketUrl.trim() || null,
          primary_vibe: editCategory?.toLowerCase() ?? null,
          gender_rule: editGenderRule,
          max_invites: editGroupSize,
        })
        .eq('id', plan.id)
        .eq('creator_user_id', currentUserId);

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setManageModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save changes.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelPlan = () => {
    Alert.alert(
      'Cancel this plan?',
      'This will cancel the plan for everyone. Members will be notified in the group chat.',
      [
        { text: 'Keep Plan', style: 'cancel' },
        {
          text: 'Cancel Plan',
          style: 'destructive',
          onPress: async () => {
            if (!plan || !currentUserId) return;
            try {
              await supabase
                .from('events')
                .update({ status: 'cancelled' })
                .eq('id', plan.id)
                .eq('creator_user_id', currentUserId);

              await supabase.from('messages').insert({
                event_id: plan.id,
                user_id: currentUserId,
                content: 'cancelled this plan',
                message_type: 'system',
              });

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              setManageModalVisible(false);
              queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
              queryClient.invalidateQueries({ queryKey: ['my-plans'] });
              router.back();
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not cancel plan.');
            }
          },
        },
      ],
    );
  };

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
        {/* Get Tickets — only shown after joining */}
        {plan.tickets_url && (isMember || isHost) && (
          <TouchableOpacity
            style={styles.ticketButton}
            onPress={() => Linking.openURL(plan.tickets_url!)}
            activeOpacity={0.85}
          >
            <Text style={styles.ticketButtonText}>Get Tickets →</Text>
          </TouchableOpacity>
        )}

        {isHost ? (
          <View>
            <View style={styles.memberActions}>
              <TouchableOpacity
                style={styles.manageButton}
                onPress={openManageModal}
              >
                <Text style={styles.manageButtonText}>Manage Plan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => router.push(`/(tabs)/chats/${plan.id}` as any)}
              >
                <MessageCircle size={18} color="#FFFFFF" strokeWidth={2} />
                <Text style={styles.openChatText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : isMember ? (
          <View>
            <View style={styles.memberActions}>
              <TouchableOpacity style={styles.youreGoingBadge} onPress={handleLeave}>
                <Text style={styles.youreGoingText}>Can't make it?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => router.push(`/(tabs)/chats/${plan.id}` as any)}
              >
                <MessageCircle size={18} color="#FFFFFF" strokeWidth={2} />
                <Text style={styles.openChatText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : isFull ? (
          <TouchableOpacity style={styles.waitlistButton}>
            <Text style={styles.waitlistButtonText}>Join Waitlist</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setJoinModalVisible(true);
            }}
          >
            <Text style={styles.joinButtonText}>Join Plan</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Join Confirmation Modal */}
      <Modal visible={joinModalVisible} transparent animationType="fade" onRequestClose={() => setJoinModalVisible(false)}>
        <Pressable style={joinStyles.overlay} onPress={() => { Keyboard.dismiss(); setJoinModalVisible(false); }}>
          <Pressable style={joinStyles.sheet} onPress={() => Keyboard.dismiss()}>
            <TouchableOpacity
              style={joinStyles.closeButton}
              onPress={() => setJoinModalVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={joinStyles.closeX}>✕</Text>
            </TouchableOpacity>

            <Text style={joinStyles.title}>You're joining {plan?.title}</Text>
            <Text style={joinStyles.subtitle}>
              {plan ? `${formatFullDate(plan.start_time)} at ${formatTime(plan.start_time)}` : ''}
            </Text>

            <View style={joinStyles.infoBox}>
              <Text style={joinStyles.infoTitle}>WashedUp groups are small on purpose.</Text>
              <Text style={joinStyles.infoText}>You're not just a number.</Text>
              <Text style={joinStyles.infoText}>You're part of the plan.</Text>
            </View>

            <Text style={joinStyles.label}>Say hi to people that are going too! <Text style={joinStyles.required}>*required</Text></Text>
            <TextInput
              style={[joinStyles.input, !joinMessage.trim() && joinConfirmed && joinStyles.inputRequired]}
              placeholder="Hey everyone! Can't wait"
              placeholderTextColor="#999999"
              value={joinMessage}
              onChangeText={setJoinMessage}
              multiline
              maxLength={200}
            />
            <Text style={joinStyles.hint}>This will be posted to the group chat when you join</Text>

            <TouchableOpacity
              style={joinStyles.checkRow}
              onPress={() => setJoinConfirmed(!joinConfirmed)}
              activeOpacity={0.7}
            >
              <View style={[joinStyles.checkbox, joinConfirmed && joinStyles.checkboxChecked]}>
                {joinConfirmed && <Text style={joinStyles.checkmark}>✓</Text>}
              </View>
              <Text style={joinStyles.checkLabel}>I'm coming</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[joinStyles.joinBtn, (!joinConfirmed || !joinMessage.trim()) && joinStyles.joinBtnDisabled]}
              onPress={() => joinMutation.mutate(joinMessage)}
              disabled={!joinConfirmed || !joinMessage.trim() || joinMutation.isPending}
              activeOpacity={0.85}
            >
              {joinMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={joinStyles.joinBtnText}>Join</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Ticket Prompt Modal — shown after joining a ticketed event */}
      <Modal visible={ticketModalVisible} transparent animationType="fade" onRequestClose={() => setTicketModalVisible(false)}>
        <Pressable style={joinStyles.overlay} onPress={() => setTicketModalVisible(false)}>
          <Pressable style={ticketStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={ticketStyles.emoji}>🎟</Text>
            <Text style={ticketStyles.title}>This plan is ticketed!</Text>
            <Text style={ticketStyles.subtitle}>
              Make sure to grab your tickets so you're all set for the day.
            </Text>

            <TouchableOpacity
              style={ticketStyles.primaryBtn}
              onPress={() => {
                setTicketModalVisible(false);
                if (plan?.tickets_url) Linking.openURL(plan.tickets_url);
              }}
              activeOpacity={0.85}
            >
              <Text style={ticketStyles.primaryBtnText}>Get Tickets Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={ticketStyles.secondaryBtn}
              onPress={() => setTicketModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={ticketStyles.secondaryBtnText}>I'll remember</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Manage Plan Modal */}
      <Modal visible={manageModalVisible} transparent animationType="slide" onRequestClose={() => setManageModalVisible(false)}>
        <View style={manageStyles.overlay}>
          <View style={manageStyles.sheet}>
            <View style={manageStyles.headerRow}>
              <Text style={manageStyles.title}>Manage Plan</Text>
              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setManageModalVisible(false); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={manageStyles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Title */}
              <Text style={manageStyles.label}>Title</Text>
              <TextInput
                style={manageStyles.input}
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={80}
                placeholder="Plan title"
                placeholderTextColor="#999"
              />

              {/* Description */}
              <Text style={manageStyles.label}>Plan description</Text>
              <TextInput
                style={[manageStyles.input, manageStyles.textArea]}
                value={editDescription}
                onChangeText={setEditDescription}
                multiline
                maxLength={500}
                placeholder="What's the plan? Dress code, what to expect..."
                placeholderTextColor="#999"
              />

              {/* Host message */}
              <Text style={manageStyles.label}>Your message</Text>
              <TextInput
                style={[manageStyles.input, manageStyles.hostMessageInput]}
                value={editHostMessage}
                onChangeText={setEditHostMessage}
                multiline
                maxLength={150}
                placeholder="A personal note to people joining"
                placeholderTextColor="#999"
              />

              {/* Location */}
              <Text style={manageStyles.label}>Location</Text>
              <View style={{ zIndex: 10 }}>
                <GooglePlacesAutocomplete
                  ref={managePlacesRef}
                  placeholder="Venue or neighborhood"
                  fetchDetails
                  onPress={(data, details) => {
                    const lat = details?.geometry?.location?.lat ?? null;
                    const lng = details?.geometry?.location?.lng ?? null;
                    const name = data.structured_formatting?.main_text ?? data.description;
                    setEditLocation(name || data.description);
                    setEditLocationLat(lat);
                    setEditLocationLng(lng);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  query={{
                    key: GOOGLE_MAPS_API_KEY,
                    language: 'en',
                    components: 'country:us',
                    location: '34.0522,-118.2437',
                    radius: '50000',
                  }}
                  styles={managePlacesStyles}
                  textInputProps={{
                    placeholderTextColor: '#999',
                  }}
                  enablePoweredByContainer={false}
                  debounce={300}
                  keepResultsAfterBlur={false}
                  nearbyPlacesAPI="GooglePlacesSearch"
                />
              </View>

              {/* Ticket link */}
              <Text style={manageStyles.label}>Ticket link</Text>
              <TextInput
                style={manageStyles.input}
                value={editTicketUrl}
                onChangeText={setEditTicketUrl}
                placeholder="https://..."
                placeholderTextColor="#999"
                autoCapitalize="none"
                keyboardType="url"
              />

              {/* Category */}
              <Text style={manageStyles.label}>Category</Text>
              <View style={manageStyles.pillWrap}>
                {MANAGE_CATEGORIES.map((cat) => {
                  const isSelected = editCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[manageStyles.pill, isSelected && manageStyles.pillSelected]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setEditCategory(cat);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{cat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Who can join */}
              <Text style={manageStyles.label}>Who can join</Text>
              <View style={manageStyles.genderRow}>
                {MANAGE_GENDER_OPTIONS.map((opt) => {
                  const isSelected = editGenderRule === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[manageStyles.genderPill, isSelected && manageStyles.pillSelected]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setEditGenderRule(opt.value);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[manageStyles.pillText, isSelected && manageStyles.pillTextSelected]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Group size */}
              <Text style={manageStyles.label}>Group size</Text>
              <View style={manageStyles.stepperRow}>
                <TouchableOpacity
                  style={[manageStyles.stepperBtn, editGroupSize <= MIN_GROUP && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize > MIN_GROUP) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setEditGroupSize((g) => g - 1);
                    }
                  }}
                  disabled={editGroupSize <= MIN_GROUP}
                >
                  <Text style={manageStyles.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <View style={manageStyles.stepperValue}>
                  <Text style={manageStyles.stepperValueText}>{editGroupSize}</Text>
                  <Text style={manageStyles.stepperValueSub}>people</Text>
                </View>
                <TouchableOpacity
                  style={[manageStyles.stepperBtn, editGroupSize >= MAX_GROUP && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize < MAX_GROUP) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setEditGroupSize((g) => g + 1);
                    }
                  }}
                  disabled={editGroupSize >= MAX_GROUP}
                >
                  <Text style={manageStyles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>

              {/* Save button */}
              <TouchableOpacity
                style={[manageStyles.saveBtn, (editSaving || editTitle.trim().length === 0) && manageStyles.saveBtnDisabled]}
                onPress={handleSaveEdit}
                disabled={editSaving || editTitle.trim().length === 0}
                activeOpacity={0.85}
              >
                {editSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={manageStyles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>

              {/* Cancel plan */}
              <TouchableOpacity
                style={manageStyles.cancelBtn}
                onPress={handleCancelPlan}
                activeOpacity={0.7}
              >
                <Text style={manageStyles.cancelBtnText}>Cancel This Plan</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manageButtonText: { color: '#C4652A', fontSize: 15, fontWeight: '700' },
});

const joinStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
  },
  closeX: {
    fontSize: 18,
    color: '#999999',
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 4,
    paddingRight: 32,
  },
  subtitle: {
    fontSize: 14,
    color: '#999999',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: '#FFF8F0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  required: {
    fontSize: 12,
    fontWeight: '400',
    color: '#C4652A',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F0E6D3',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1A1A1A',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputRequired: {
    borderColor: '#C4652A',
  },
  hint: {
    fontSize: 12,
    color: '#999999',
    marginTop: 6,
    marginBottom: 20,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#C4652A',
    borderColor: '#C4652A',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  checkLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  joinBtn: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.35,
  },
  joinBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

const ticketStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: {
    color: '#999999',
    fontSize: 15,
    fontWeight: '600',
  },
});

const managePlacesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#1A1A1A',
    height: 46,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFFFFF' },
  separator: { height: 1, backgroundColor: '#F0E6D3', marginHorizontal: 14 },
  description: { color: '#1A1A1A', fontSize: 14 },
  poweredContainer: { display: 'none' as const },
};

const manageStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  closeX: {
    fontSize: 18,
    color: '#999999',
    fontWeight: '600',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9B8B7A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1A1A',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  hostMessageInput: {
    minHeight: 50,
    textAlignVertical: 'top',
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 20,
  },
  pillSelected: {
    backgroundColor: '#C4652A',
    borderColor: '#C4652A',
  },
  pillText: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  pillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    borderRadius: 14,
    alignItems: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontSize: 22, color: '#1A1A1A', fontWeight: '300' },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontSize: 28, fontWeight: '700', color: '#C4652A' },
  stepperValueSub: { fontSize: 12, color: '#999999', marginTop: -2 },
  saveBtn: {
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  cancelBtnText: { color: '#DC2626', fontSize: 14, fontWeight: '600' },
});
