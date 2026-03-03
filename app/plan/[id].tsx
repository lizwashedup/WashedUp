import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
    ArrowLeft,
    Calendar,
    Heart,
    MapPin,
    MessageCircle,
    MoreHorizontal,
    Users
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Keyboard,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReportModal } from '../../components/modals/ReportModal';
import { SharePlanModal } from '../../components/modals/SharePlanModal';
import Colors from '../../constants/Colors';
import { capDisplayCount, MAX_GROUP, MIN_GROUP } from '../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../constants/Typography';
import { BrandedAlert } from '../../components/BrandedAlert';
import { checkContent } from '../../lib/contentFilter';
import { useBlock } from '../../hooks/useBlock';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * (9 / 16);

const MANAGE_CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;

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
  target_age_min: number | null;
  target_age_max: number | null;
  status: string;
  creator_id: string;
  tickets_url: string | null;
  creator: {
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

function formatWhenShort(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateStart.getTime() === todayStart.getTime()) return 'Tonight';
  if (dateStart.getTime() === tomorrowStart.getTime()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function buildCalendarUrl(title: string, startTime: string, location?: string): string {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: location || '',
    details: 'WashedUp plan — washedup.app',
  });
  return `https://calendar.google.com/calendar/event?${params.toString()}`;
}

function formatGenderLabel(gender_rule: string | null): string | null {
  if (!gender_rule || gender_rule === 'mixed') return null;
  if (gender_rule === 'women_only') return 'Women Only';
  if (gender_rule === 'men_only') return 'Men Only';
  if (gender_rule === 'nonbinary_only') return 'Nonbinary Only';
  return null;
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
      max_invites, min_invites, target_age_min, target_age_max,
      status, member_count, creator_user_id, tickets_url
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  const row = data as any;

  // Fetch creator via profiles_public view (bypasses profiles RLS for other users)
  let creator: PlanDetail['creator'] = null;
  if (row.creator_user_id) {
    const { data: profileRow } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url, bio')
      .eq('id', row.creator_user_id)
      .maybeSingle();

    if (profileRow) {
      creator = {
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
    target_age_min: row.target_age_min ?? null,
    target_age_max: row.target_age_max ?? null,
    status: row.status,
    creator_id: row.creator_user_id ?? null,
    tickets_url: row.tickets_url ?? null,
    member_count: row.member_count ?? 0,
    creator,
  };
}

async function fetchMembers(planId: string): Promise<Member[]> {
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_event_members_reveal', { p_event_id: planId });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return rpcData.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      first_name: row.first_name ?? row.first_name_display ?? null,
      avatar_url: row.avatar_url ?? row.profile_photo_url ?? null,
      joined_at: row.joined_at ?? '',
    }));
  }

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
      <Image
        source={{ uri: member.avatar_url }}
        style={styles.memberAvatar}
        contentFit="cover"
        transition={200}
      />
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
  const insets = useSafeAreaInsets();
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
  const [editCreatorMessage, setEditCreatorMessage] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLocationLat, setEditLocationLat] = useState<number | null>(null);
  const [editLocationLng, setEditLocationLng] = useState<number | null>(null);
  const [editTicketUrl, setEditTicketUrl] = useState('');
  const managePlacesRef = React.useRef<GooglePlacesAutocompleteRef>(null);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [editGenderRule, setEditGenderRule] = useState('mixed');
  const [editGroupSize, setEditGroupSize] = useState(6);
  const [editSaving, setEditSaving] = useState(false);
  const [userGender, setUserGender] = useState<string | null>(null);
  const [userAge, setUserAge] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [shareAfterJoinVisible, setShareAfterJoinVisible] = useState(false);
  const [isOnWaitlist, setIsOnWaitlist] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [brandedAlert, setBrandedAlert] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    buttons?: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[];
  }>({ visible: false, title: '' });

  const { blockUser } = useBlock();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('gender, birthday')
        .eq('id', user.id)
        .single();

      if (profile?.gender) setUserGender(profile.gender);
      if (profile?.birthday) {
        const birth = new Date(profile.birthday);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const md = today.getMonth() - birth.getMonth();
        if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
        setUserAge(age);
      }
    })();
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

  // Prefetch avatar images so they load faster when displayed
  useEffect(() => {
    const urls: string[] = [];
    if (plan?.creator?.avatar_url) urls.push(plan.creator.avatar_url);
    members.forEach((m) => { if (m.avatar_url) urls.push(m.avatar_url); });
    if (urls.length > 0) {
      Image.prefetch(urls).catch(() => {});
    }
  }, [plan?.creator?.avatar_url, members]);

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

  // Waitlist check
  useEffect(() => {
    if (!currentUserId || !id) return;
    supabase
      .from('event_waitlist')
      .select('id')
      .eq('event_id', id)
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data }) => setIsOnWaitlist(!!data));
  }, [currentUserId, id]);

  // Pending invite check
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null);
  useEffect(() => {
    if (!currentUserId || !id) return;
    supabase
      .from('plan_invites')
      .select('id')
      .eq('event_id', id)
      .eq('recipient_id', currentUserId)
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => setPendingInviteId(data?.id ?? null));
  }, [currentUserId, id]);

  const isMember = members.some((m) => m.user_id === currentUserId);
  const isCreator = plan?.creator_id === currentUserId;
  // Use actual member count when available — member_count can be out of sync
  const displayMemberCount = members.length > 0 ? capDisplayCount(members.length) : capDisplayCount(plan?.member_count ?? 0);
  const totalCapacity = Math.min((plan?.max_invites ?? 7) + 1, MAX_GROUP);
  const isFull = plan ? displayMemberCount >= totalCapacity : false;
  const spotsLeft = plan ? Math.max(0, totalCapacity - displayMemberCount) : 0;

  const manageGenderOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [
      { label: 'Mixed', value: 'mixed' },
    ];
    if (userGender === 'woman') {
      opts.push({ label: 'Women Only', value: 'women_only' });
    } else if (userGender === 'man') {
      opts.push({ label: 'Men Only', value: 'men_only' });
    } else if (userGender === 'non_binary') {
      opts.push({ label: 'Nonbinary Only', value: 'nonbinary_only' });
    }
    return opts;
  }, [userGender]);

  const isEligible = useMemo(() => {
    if (!plan) return false;
    const gr = plan.gender_rule;
    if (gr === 'women_only' && userGender !== 'woman') return false;
    if (gr === 'men_only' && userGender !== 'man') return false;
    if (gr === 'nonbinary_only' && userGender !== 'non_binary') return false;
    if (userAge !== null) {
      if (plan.target_age_min !== null && userAge < plan.target_age_min) return false;
      if (plan.target_age_max !== null && userAge > plan.target_age_max) return false;
    }
    return true;
  }, [plan, userGender, userAge]);

  // ─── Join ────────────────────────────────────────────────────────────────────

  const joinMutation = useMutation({
    mutationFn: async (greeting?: string) => {
      if (!currentUserId || !id) throw new Error('Not authenticated');
      if (!plan) throw new Error('Plan not loaded');

      try {
        const { data: canJoinGender } = await supabase.rpc('can_join_event_gender', {
          p_user_id: currentUserId,
          p_event_id: id,
        });
        if (canJoinGender === false) {
          throw new Error('This plan is restricted and you are not eligible to join.');
        }
      } catch (eligibilityError: any) {
        if (eligibilityError.message?.includes('not eligible')) throw eligibilityError;
      }

      const { data, error } = await supabase.rpc('join_event_atomic', {
        p_event_id: id,
        p_user_id: currentUserId,
        p_age_at_join: userAge ?? null,
        p_gender_at_join: userGender ?? null,
      });

      const rpcUnavailable = error && (error.message?.includes('does not exist') || (error as any).code === '42883');

      if (!rpcUnavailable && error) throw error;
      if (!rpcUnavailable && data === 'full') throw new Error('This plan is full. Try joining the waitlist.');
      if (!rpcUnavailable && data === 'not_found') throw new Error('This plan no longer exists.');

      if (rpcUnavailable) {
        // Fallback when join_event_atomic RPC not deployed
        const { data: existing } = await supabase.from('event_members').select('id').eq('event_id', id).eq('user_id', currentUserId).maybeSingle();
        if (existing) {
          const { error: updateError } = await supabase.from('event_members').update({ status: 'joined', role: 'guest' }).eq('event_id', id).eq('user_id', currentUserId);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase.from('event_members').insert({ event_id: id, user_id: currentUserId, role: 'guest', status: 'joined' });
          if (insertError) throw insertError;
        }
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

      setShareAfterJoinVisible(true);
    },
    onError: (error: any) => {
      setBrandedAlert({ visible: true, title: 'Oops', message: error.message ?? 'Something went wrong.' });
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
      setBrandedAlert({ visible: true, title: 'Oops', message: error.message ?? 'Something went wrong.' });
    },
  });

  const handleLeave = () => {
    setBrandedAlert({
      visible: true,
      title: "Can't make it?",
      message: 'Your spot will open for someone else. The group will be notified.',
      buttons: [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave Plan',
          style: 'destructive',
          onPress: () => leaveMutation.mutate(),
        },
      ],
    });
  };

  // ─── Manage Plan ─────────────────────────────────────────────────────────────

  const openManageModal = () => {
    if (!plan) return;
    setEditTitle(plan.title);
    setEditDescription(plan.description ?? '');
    setEditCreatorMessage(plan.host_message ?? '');
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

    const fieldsToCheck = [editTitle, editDescription, editCreatorMessage].filter(Boolean).join(' ');
    const filter = checkContent(fieldsToCheck);
    if (!filter.ok) {
      setBrandedAlert({ visible: true, title: 'Content not allowed', message: filter.reason ?? 'Please revise your plan and try again.' });
      return;
    }

    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          host_message: editCreatorMessage.trim() || null,
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
      const rawMsg = e?.message ?? '';
      const msg = rawMsg.includes('events_host_message_length')
        ? 'Message must be at least 10 characters.'
        : rawMsg || 'Could not save changes.';
      setBrandedAlert({ visible: true, title: 'Error', message: msg });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelPlan = () => {
    setBrandedAlert({
      visible: true,
      title: 'Cancel this plan?',
      message: 'This will cancel the plan for everyone. Members will be notified in the group chat.',
      buttons: [
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
              setBrandedAlert({ visible: true, title: 'Error', message: e.message ?? 'Could not cancel plan.' });
            }
          },
        },
      ],
    });
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

  // ─── Waitlist ─────────────────────────────────────────────────────────────────

  const handleJoinWaitlist = useCallback(async () => {
    if (waitlistLoading || !currentUserId || !id) return;
    setWaitlistLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isOnWaitlist) {
        await supabase
          .from('event_waitlist')
          .delete()
          .eq('event_id', id)
          .eq('user_id', currentUserId);
        setIsOnWaitlist(false);
      } else {
        await supabase
          .from('event_waitlist')
          .insert({ event_id: id, user_id: currentUserId });
        setIsOnWaitlist(true);
        setBrandedAlert({
          visible: true,
          title: "You're on the waitlist",
          message: "We'll notify you if a spot opens up.",
        });
      }
    } catch {
      setBrandedAlert({ visible: true, title: 'Error', message: 'Please try again.' });
    } finally {
      setWaitlistLoading(false);
    }
  }, [currentUserId, id, isOnWaitlist, waitlistLoading]);

  // ─── Share ───────────────────────────────────────────────────────────────────

  const handleShare = useCallback(async () => {
    if (!plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `Join me for "${plan.title}" on WashedUp!\nhttps://washedup.app/e/${plan.id}`,
      });
    } catch {}
  }, [plan]);

  const handleReportMenu = useCallback(() => {
    if (isCreator || !plan?.creator) return;
    const creatorName = plan.creator?.first_name ?? 'Creator';
    Alert.alert(
      'Options',
      undefined,
      [
        {
          text: `Report ${creatorName}`,
          onPress: () => {
            setReportTarget({ id: plan.creator?.id ?? '', name: creatorName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${creatorName}`,
          style: 'destructive',
          onPress: () => blockUser(plan.creator?.id ?? '', creatorName, () => router.back()),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [isCreator, plan, blockUser]);

  // ─── Loading / Error ─────────────────────────────────────────────────────────

  if (planLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
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

  const creatorMeta = [
      plan.location_text,
    ].filter(Boolean).join(' • ');

  const categoryTags = [
      plan.primary_vibe ? plan.primary_vibe.charAt(0).toUpperCase() + plan.primary_vibe.slice(1) : null,
      genderLabel,
    ].filter(Boolean);

  const groupSizeLabel = totalCapacity <= 4 ? 'Small group • intimate' : totalCapacity <= 6 ? 'Cozy group' : 'Larger group';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Custom Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back to plans"
        >
          <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2.5} />
          <Text style={styles.backButtonText}>Plans</Text>
        </TouchableOpacity>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            onPress={handleShare}
            style={styles.headerIconButton}
            accessibilityLabel="Share this plan"
          >
            <Ionicons name="share-outline" size={22} color={Colors.asphalt} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleWishlist}
            style={styles.headerIconButton}
            accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            <Heart
              size={20}
              color={isWishlisted ? Colors.errorRed : Colors.asphalt}
              fill={isWishlisted ? Colors.errorRed : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
          {!isCreator && plan?.creator && (
            <TouchableOpacity
              onPress={handleReportMenu}
              style={styles.headerIconButton}
              accessibilityLabel="Report or block"
            >
              <MoreHorizontal size={20} color={Colors.asphalt} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* A. Creator Info */}
        <View style={styles.creatorBlock}>
          {plan.creator?.avatar_url ? (
            <Image
              source={{ uri: plan.creator?.avatar_url ?? '' }}
              style={styles.creatorAvatarLarge}
              contentFit="cover"
              transition={200}
              priority="high"
            />
          ) : (
            <View style={[styles.creatorAvatarLarge, styles.creatorAvatarPlaceholder]}>
              <Ionicons name="person-outline" size={32} color={Colors.textLight} />
            </View>
          )}
          <View style={styles.creatorDetails}>
            <Text style={styles.postedBy}>POSTED BY</Text>
            <Text style={styles.creatorNameLarge}>{plan.creator?.first_name ?? 'Someone'}</Text>
            <Text style={styles.creatorMeta}>{creatorMeta}</Text>
          </View>
        </View>

        {/* B. Plan Title */}
        <Text style={styles.planTitle}>{plan.title}</Text>

        {/* C. Category Tags */}
        {categoryTags.length > 0 && (
          <View style={styles.categoryTagsRow}>
            {categoryTags.map((tag) => (
              <View key={tag} style={styles.categoryTag}>
                <Text style={styles.categoryTagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* D. Creator's Note */}
        {plan.host_message && (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>{`${plan.creator?.first_name ?? 'CREATOR'}'S NOTE`}</Text>
            <Text style={styles.noteText}>{plan.host_message}</Text>
          </View>
        )}

        {/* E. Logistics Section */}
        <View style={styles.logisticsCard}>
          <View style={styles.logisticsRow}>
            <Calendar size={18} color={Colors.terracotta} strokeWidth={2} />
            <View style={styles.logisticsContent}>
              <Text style={styles.logisticsMain}>
                {formatWhenShort(plan.start_time)} • {formatTime(plan.start_time)}
              </Text>
              <Text style={styles.logisticsSub}>{formatFullDate(plan.start_time)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => Linking.openURL(buildCalendarUrl(plan.title, plan.start_time, plan.location_text ?? undefined))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.logisticsLink}>Add to Calendar</Text>
            </TouchableOpacity>
          </View>

          {plan.location_text && (
            <View style={[styles.logisticsRow, styles.logisticsRowBorder]}>
              <MapPin size={18} color={Colors.terracotta} strokeWidth={2} />
              <View style={styles.logisticsContent}>
                <Text style={styles.logisticsMain}>{plan.location_text}</Text>
              </View>
              <TouchableOpacity
                onPress={() => openDirections(plan.location_text!)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.logisticsLink}>Map →</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.logisticsRow, styles.logisticsRowBorder]}>
            <Users size={18} color={Colors.terracotta} strokeWidth={2} />
            <View style={styles.logisticsContent}>
              <Text style={styles.logisticsMain}>
                {displayMemberCount} of {totalCapacity} spots filled
              </Text>
              <Text style={styles.logisticsSub}>{groupSizeLabel}</Text>
            </View>
          </View>
        </View>

        {/* F. Who's Going */}
        <Text style={styles.whoGoingTitle}>Who's going</Text>
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

        {/* G. CTA hints (button is in sticky bar) */}
        {!isCreator && !isMember && isEligible && !isFull && (
          <View style={styles.ctaBlock}>
            {spotsLeft > 0 && spotsLeft <= 2 && (
              <Text style={styles.ctaInfo}>
                {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left — group closes soon
              </Text>
            )}
            <Text style={styles.ctaSub}>A group chat opens the moment you join</Text>
          </View>
        )}
      </ScrollView>

      {/* ─── Sticky Bottom Bar ─────────────────────────────────────────────────── */}

      <View style={styles.stickyBar}>
        {/* Get Tickets — only shown after joining */}
        {plan.tickets_url && (isMember || isCreator) && (
          <TouchableOpacity
            style={styles.ticketButton}
            onPress={() => openUrl(plan.tickets_url!)}
            activeOpacity={0.85}
          >
            <Text style={styles.ticketButtonText}>Get Tickets →</Text>
          </TouchableOpacity>
        )}

        {isCreator ? (
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
                <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
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
                <MessageCircle size={18} color={Colors.white} strokeWidth={2} />
                <Text style={styles.openChatText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : !isEligible ? (
          <View style={styles.ineligibleBar}>
            <Text style={styles.ineligibleText}>This plan isn't available for you</Text>
            <Text style={styles.ineligibleSub}>It's restricted by age or gender</Text>
          </View>
        ) : isFull ? (
          <TouchableOpacity
            style={[
              styles.waitlistButton,
              isOnWaitlist && styles.waitlistButtonActive,
            ]}
            onPress={handleJoinWaitlist}
            disabled={waitlistLoading}
            activeOpacity={0.9}
          >
            {waitlistLoading ? (
              <ActivityIndicator size="small" color={isOnWaitlist ? Colors.white : Colors.terracotta} />
            ) : (
              <Text style={[
                styles.waitlistButtonText,
                isOnWaitlist && styles.waitlistButtonTextActive,
              ]}>
                {isOnWaitlist ? 'On Waitlist ✓' : 'Join Waitlist'}
              </Text>
            )}
          </TouchableOpacity>
        ) : pendingInviteId ? (
          <View style={styles.inviteActions}>
            <TouchableOpacity
              style={styles.declineInviteButton}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                await supabase
                  .from('plan_invites')
                  .update({ status: 'declined', updated_at: new Date().toISOString() })
                  .eq('id', pendingInviteId);
                setPendingInviteId(null);
                queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
                queryClient.invalidateQueries({ queryKey: ['inbox-count'] });
                setBrandedAlert({
                  visible: true,
                  title: 'No worries',
                  message: "Maybe next time! We won't tell them.",
                });
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.declineInviteText}>Can't make it</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.acceptInviteButton}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await supabase
                  .from('plan_invites')
                  .update({ status: 'accepted', updated_at: new Date().toISOString() })
                  .eq('id', pendingInviteId);
                setPendingInviteId(null);
                queryClient.invalidateQueries({ queryKey: ['pending-invites'] });
                queryClient.invalidateQueries({ queryKey: ['inbox-count'] });
                setJoinModalVisible(true);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.acceptInviteText}>Accept Invite</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setJoinModalVisible(true);
            }}
            activeOpacity={0.9}
          >
            <Text style={styles.joinButtonText}>Let's Go →</Text>
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

            <Text style={joinStyles.label}>Say something to the group <Text style={joinStyles.required}>*required</Text></Text>
            <TextInput
              style={[joinStyles.input, !joinMessage.trim() && joinConfirmed && joinStyles.inputRequired]}
              placeholder="Hey everyone! Can't wait"
              placeholderTextColor={Colors.textLight}
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
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={joinStyles.joinBtnText}>Join</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <SharePlanModal
        visible={shareAfterJoinVisible}
        onClose={() => {
          setShareAfterJoinVisible(false);
          router.push(`/(tabs)/chats/${id}` as any);
          if (plan?.tickets_url) {
            setTimeout(() => setTicketModalVisible(true), 600);
          }
        }}
        planTitle={plan?.title || ''}
        planId={id as string}
        variant="joined"
      />

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
                if (plan?.tickets_url) openUrl(plan.tickets_url);
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
              scrollIndicatorInsets={{ right: 2 }}
            >
              {/* Title */}
              <Text style={manageStyles.label}>Title</Text>
              <TextInput
                style={manageStyles.input}
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={80}
                placeholder="Plan title"
                placeholderTextColor={Colors.textLight}
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
                placeholderTextColor={Colors.textLight}
              />

              {/* Creator note */}
              <Text style={manageStyles.label}>Your message</Text>
              <TextInput
                style={[manageStyles.input, manageStyles.creatorMessageInput]}
                value={editCreatorMessage}
                onChangeText={setEditCreatorMessage}
                multiline
                maxLength={150}
                placeholder="A personal note to people joining"
                placeholderTextColor={Colors.textLight}
              />
              <Text style={manageStyles.hint}>Min 10 characters · Max 150</Text>

              {/* Location */}
              <Text style={manageStyles.label}>Location</Text>
              <View style={{ zIndex: 10 }}>
                <GooglePlacesAutocomplete
                  ref={managePlacesRef}
                  placeholder="Venue or neighborhood"
                  fetchDetails
                  disableScroll={true}
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
                    placeholderTextColor: Colors.textLight,
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
                placeholderTextColor={Colors.textLight}
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
                {manageGenderOptions.map((opt) => {
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

              {/* How many to invite */}
              <Text style={manageStyles.label}>How many to invite</Text>
              <View style={manageStyles.stepperRow}>
                <TouchableOpacity
                  style={[manageStyles.stepperBtn, editGroupSize <= (MIN_GROUP - 1) && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize > (MIN_GROUP - 1)) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setEditGroupSize((g) => g - 1);
                    }
                  }}
                  disabled={editGroupSize <= (MIN_GROUP - 1)}
                >
                  <Text style={manageStyles.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <View style={manageStyles.stepperValue}>
                  <Text style={manageStyles.stepperValueText}>{editGroupSize}</Text>
                  <Text style={manageStyles.stepperValueSub}>people + you</Text>
                </View>
                <TouchableOpacity
                  style={[manageStyles.stepperBtn, editGroupSize >= (MAX_GROUP - 1) && manageStyles.stepperBtnDisabled]}
                  onPress={() => {
                    if (editGroupSize < (MAX_GROUP - 1)) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setEditGroupSize((g) => g + 1);
                    }
                  }}
                  disabled={editGroupSize >= (MAX_GROUP - 1)}
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
                  <ActivityIndicator size="small" color={Colors.white} />
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

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={plan.id}
        />
      )}

      <BrandedAlert
        visible={brandedAlert.visible}
        title={brandedAlert.title}
        message={brandedAlert.message}
        buttons={brandedAlert.buttons}
        onClose={() => setBrandedAlert((a) => ({ ...a, visible: false }))}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textMedium },
  linkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.parchment,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  creatorBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  creatorAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  creatorAvatarPlaceholder: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorDetails: {
    marginLeft: 16,
    flex: 1,
  },
  postedBy: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  creatorNameLarge: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 2,
  },
  creatorMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },
  planTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    lineHeight: 34,
    marginBottom: 12,
  },
  categoryTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  categoryTag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryTagText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  noteBox: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: Colors.goldenAmber,
  },
  noteLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  noteText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    lineHeight: 22,
  },
  logisticsCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logisticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logisticsRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 12,
    paddingTop: 12,
  },
  logisticsContent: {
    flex: 1,
  },
  logisticsMain: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  logisticsSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginTop: 2,
  },
  logisticsLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  whoGoingTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 12,
  },
  memberAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  memberAvatarWrapper: {
    marginRight: -8,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Colors.parchment,
  },
  memberAvatarPlaceholder: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  memberAvatarOverflow: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarOverflowText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  ctaBlock: {
    marginTop: 8,
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  ctaInfo: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    marginBottom: 4,
  },
  ctaSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
  },
  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: Colors.parchment,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  ticketButton: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  ticketButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  joinButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
  },
  declineInviteButton: {
    flex: 1,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineInviteText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  acceptInviteButton: {
    flex: 1.5,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptInviteText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  youreGoingBadge: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  youreGoingText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  openChatButton: {
    flex: 1,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openChatText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD },
  waitlistButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  waitlistButtonActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  waitlistButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  waitlistButtonTextActive: { color: Colors.white },
  ineligibleBar: { paddingVertical: 16, alignItems: 'center' },
  ineligibleText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  ineligibleSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 4 },
  manageButton: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manageButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});

const joinStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
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
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.textLight,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 4,
    paddingRight: 32,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textLight,
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: Colors.parchment,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 18,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  required: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    padding: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputRequired: {
    borderColor: Colors.terracotta,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
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
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  checkmark: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
  },
  checkLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  joinBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.35,
  },
  joinBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
  },
});

const ticketStyles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  emoji: {
    fontSize: FontSizes.displayXL,
    marginBottom: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: {
    color: Colors.textLight,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
  },
});

const managePlacesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    height: 46,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: Colors.white },
  separator: { height: 1, backgroundColor: Colors.inputBg, marginHorizontal: 14 },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  poweredContainer: { display: 'none' as const },
};

const manageStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
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
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  closeX: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.textLight,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  creatorMessageInput: {
    minHeight: 50,
    textAlignVertical: 'top',
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 4,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 20,
  },
  pillSelected: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  pillTextSelected: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
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
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontFamily: Fonts.sans, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayLG, color: Colors.terracotta },
  stepperValueSub: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginTop: -2 },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  cancelBtnText: { color: Colors.cancelRed, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD },
});
