import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
  Modal,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Users, UserPlus, QrCode, Share2, X, MoreHorizontal, Send, Mail, Check, XCircle, Bell, Clock, Megaphone, ChevronDown, ChevronRight } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../lib/supabase';
import ProfileButton, { INBOX_COUNT_KEY } from '../../../components/ProfileButton';
import { ReportModal } from '../../../components/modals/ReportModal';
import { useBlock } from '../../../hooks/useBlock';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Friend {
  id: string;
  friend_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
}

interface SearchResult {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeHandleInput(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}

function validateHandle(handle: string): { ok: boolean; error?: string } {
  if (handle.length < 2) return { ok: false, error: 'Handle must be at least 2 characters' };
  if (handle.length > 20) return { ok: false, error: 'Handle must be 20 characters or less' };
  if (!/^[a-z0-9_]+$/.test(handle)) return { ok: false, error: 'Use only letters, numbers, and underscores' };
  const reserved = ['admin', 'support', 'help', 'washedup', 'api', 'www', 'app', 'null', 'undefined'];
  if (reserved.includes(handle)) return { ok: false, error: 'That handle is reserved' };
  return { ok: true };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function YourPeopleScreen() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Debounced handle availability check (500ms)
  React.useEffect(() => {
    const clean = handleInput.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 2) {
      setHandleAvailable(null);
      return;
    }
    const t = setTimeout(async () => {
      setCheckingHandle(true);
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('handle', clean)
        .maybeSingle();
      setHandleAvailable(!data);
      setCheckingHandle(false);
    }, 500);
    return () => clearTimeout(t);
  }, [handleInput]);

  // Current user
  const { data: userId, isLoading: userLoading } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  // My profile (for handle + blocked users)
  const { data: myProfile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['my-profile', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('id, handle, blocked_users')
        .eq('id', userId)
        .single();
      return data as { id: string; handle: string | null; blocked_users: string[] | null } | null;
    },
    enabled: !!userId,
  });

  const blockedSet = useMemo(() => new Set(myProfile?.blocked_users ?? []), [myProfile?.blocked_users]);

  // Friends list
  const { data: friends = [], refetch: refetchFriends } = useQuery({
    queryKey: ['friends', userId],
    queryFn: async (): Promise<Friend[]> => {
      if (!userId) return [];
      const { data: rows, error } = await supabase
        .from('friends')
        .select('id, friend_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return [];
      if (!rows?.length) return [];
      const ids = rows.map((r: any) => r.friend_id);
      const { data: profiles } = await supabase
        .from('profiles_public')
        .select('id, first_name_display, profile_photo_url, handle')
        .in('id', ids);
      const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return rows.map((r: any) => ({
        id: r.id,
        friend_id: r.friend_id,
        first_name_display: map.get(r.friend_id)?.first_name_display ?? null,
        profile_photo_url: map.get(r.friend_id)?.profile_photo_url ?? null,
        handle: map.get(r.friend_id)?.handle ?? null,
      }));
    },
    enabled: !!userId,
  });

  // Friend IDs set for O(1) lookup
  const friendIds = useMemo(() => new Set(friends.map((f) => f.friend_id)), [friends]);

  // Search results — handle-only for privacy (people must share their handle intentionally)
  const cleanQuery = debouncedQuery.replace(/^@/, '').toLowerCase();
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['profile-search', cleanQuery, userId],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!userId || cleanQuery.length < 2) return [];
      const { data, error } = await supabase
        .from('profiles_public')
        .select('id, first_name_display, profile_photo_url, handle')
        .ilike('handle', `%${cleanQuery}%`)
        .neq('id', userId)
        .limit(20);
      if (error) return [];
      const results = (data ?? []) as SearchResult[];
      return results.filter((r) => !blockedSet.has(r.id));
    },
    enabled: !!userId && cleanQuery.length >= 2,
  });

  useFocusEffect(
    useCallback(() => {
      refetchFriends();
      refetchProfile();
      return () => {
        setSearchQuery('');
        Keyboard.dismiss();
      };
    }, [refetchFriends, refetchProfile]),
  );

  // Add friend mutation (symmetric via RPC — RLS blocks direct insert of other user's row)
  const addFriend = useMutation({
    mutationFn: async (targetId: string) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase.rpc('add_friend', { p_friend_id: targetId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends', userId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => {
      if (err?.code === '23505') {
        Alert.alert('Already connected', 'You are already connected with this person.');
      } else {
        Alert.alert('Could not add', err?.message ?? 'Please try again.');
      }
    },
  });

  // Remove friend (delete both rows)
  const removeFriend = useCallback(
    (friend: Friend) => {
      Alert.alert(
        'Remove from Your People',
        `Remove ${friend.first_name_display ?? 'this person'} from Your People?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              if (!userId) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await supabase.rpc('remove_friend', { p_friend_id: friend.friend_id });
              queryClient.invalidateQueries({ queryKey: ['friends', userId] });
            },
          },
        ],
      );
    },
    [userId, queryClient],
  );

  // Save handle
  const saveHandle = useCallback(async () => {
    const raw = handleInput.trim().toLowerCase();
    const v = validateHandle(raw);
    if (!v.ok) {
      setHandleError(v.error ?? 'Invalid handle');
      return;
    }
    setHandleError(null);
    setSavingHandle(true);
    try {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase.from('profiles').update({ handle: raw }).eq('id', userId);
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHandleInput('');
      refetchProfile();
    } catch (err: any) {
      if (err?.code === '23505') setHandleError('That handle is already taken');
      else setHandleError(err?.message ?? 'Could not save');
    } finally {
      setSavingHandle(false);
    }
  }, [handleInput, userId, refetchProfile]);

  // Share handle
  const shareHandle = useCallback(async () => {
    const h = myProfile?.handle;
    if (!h) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `Add me on WashedUp — @${h}\nhttps://washedup.app/u/${h}`,
        title: 'Add me on WashedUp',
      });
    } catch {}
  }, [myProfile?.handle]);

  // Invite to plan
  const [inviteTarget, setInviteTarget] = useState<Friend | null>(null);
  const { data: myActivePlans = [] } = useQuery({
    queryKey: ['my-active-plans', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data: memberships } = await supabase
          .from('event_members')
          .select('event_id, events (id, title, start_time, status, max_invites, member_count)')
          .eq('user_id', userId)
          .eq('status', 'joined');
        const plans = (memberships ?? [])
          .map((m: any) => m.events)
          .filter((e: any) => e && ['forming', 'active', 'full'].includes(e.status));
        const seen = new Set<string>();
        return plans.filter((e: any) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
      } catch {
        return [];
      }
    },
    enabled: !!userId,
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1000,
  });

  const [sentInviteIds, setSentInviteIds] = useState<Set<string>>(new Set());
  const [attendingIds, setAttendingIds] = useState<Set<string>>(new Set());

  const loadSentInvites = useCallback(async (recipientId: string) => {
    if (!userId) return;
    try {
      const [inviteRes, memberRes] = await Promise.all([
        supabase
          .from('plan_invites')
          .select('event_id')
          .eq('sender_id', userId)
          .eq('recipient_id', recipientId),
        supabase
          .from('event_members')
          .select('event_id')
          .eq('user_id', recipientId)
          .eq('status', 'joined'),
      ]);
      setSentInviteIds(new Set((inviteRes.data ?? []).map((r: any) => r.event_id)));
      setAttendingIds(new Set((memberRes.data ?? []).map((r: any) => r.event_id)));
    } catch {
      setSentInviteIds(new Set());
      setAttendingIds(new Set());
    }
  }, [userId]);

  const handleInvite = useCallback((friend: Friend) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (myActivePlans.length === 0) {
      Alert.alert('No active plans', 'Post a plan first, then invite your people.');
      return;
    }
    loadSentInvites(friend.friend_id);
    setInviteTarget(friend);
  }, [myActivePlans, loadSentInvites]);

  const sendInviteLink = useCallback(async (plan: any) => {
    const target = inviteTarget;
    if (!target || !userId) { setInviteTarget(null); return; }
    setInviteTarget(null);
    const name = target.first_name_display ?? 'your friend';
    try {
      const { error } = await supabase.from('plan_invites').insert({
        event_id: plan.id, sender_id: userId, recipient_id: target.friend_id, status: 'pending',
      });
      if (error) {
        if (error.code === '23505') {
          Alert.alert('Already invited', `You already invited ${name} to "${plan.title}".`);
          return;
        }
        throw error;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Invite sent!',
        `You invited ${name} to "${plan.title}"`,
        [{ text: 'OK' }],
      );
    } catch (e: any) {
      Alert.alert('Could not send invite', e?.message ?? 'Something went wrong. Try again.');
    }
  }, [inviteTarget, userId]);

  const { blockUser } = useBlock();
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  const handleUserMenu = useCallback((targetId: string, targetName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      targetName,
      undefined,
      [
        {
          text: `Report ${targetName}`,
          onPress: () => {
            setReportTarget({ id: targetId, name: targetName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${targetName}`,
          style: 'destructive',
          onPress: () => blockUser(targetId, targetName, () => {
            queryClient.invalidateQueries({ queryKey: ['profile-search'] });
            queryClient.invalidateQueries({ queryKey: ['friends', userId] });
          }),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [blockUser, userId, queryClient]);

  // Invite inbox
  const router = useRouter();
  const params = useLocalSearchParams<{ openInbox?: string }>();
  const [showInvites, setShowInvites] = useState(false);

  React.useEffect(() => {
    if (params.openInbox === '1') {
      setShowInvites(true);
      router.setParams({ openInbox: undefined } as any);
    }
  }, [params.openInbox]);
  const { data: pendingInvites = [], refetch: refetchInvites } = useQuery({
    queryKey: ['pending-invites', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data } = await supabase
          .from('plan_invites')
          .select(`
            id, event_id, sender_id, status, created_at,
            events (id, title, start_time, status, member_count, max_invites),
            profiles!plan_invites_sender_id_fkey (first_name_display, profile_photo_url)
          `)
          .eq('recipient_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        return (data ?? []).filter((inv: any) => inv.events && ['forming', 'active', 'full'].includes(inv.events.status));
      } catch { return []; }
    },
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  // App notifications (waitlist spots, broadcasts, reminders)
  const { data: appNotifications = [], refetch: refetchNotifs } = useQuery({
    queryKey: ['app-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        await supabase.rpc('expire_stale_notifications').catch(() => {});
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, status, expires_at, created_at')
          .eq('user_id', userId)
          .eq('status', 'unread')
          .order('created_at', { ascending: false })
          .limit(30);
        return data ?? [];
      } catch { return []; }
    },
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  // Old / read invites
  const { data: oldInvites = [], refetch: refetchOldInvites } = useQuery({
    queryKey: ['old-invites', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data } = await supabase
          .from('plan_invites')
          .select(`
            id, event_id, sender_id, status, created_at, updated_at,
            events (id, title, start_time, status),
            profiles!plan_invites_sender_id_fkey (first_name_display, profile_photo_url)
          `)
          .eq('recipient_id', userId)
          .in('status', ['accepted', 'declined'])
          .order('updated_at', { ascending: false })
          .limit(20);
        return data ?? [];
      } catch { return []; }
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Old / read notifications
  const { data: oldNotifications = [], refetch: refetchOldNotifs } = useQuery({
    queryKey: ['old-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, status, created_at')
          .eq('user_id', userId)
          .in('status', ['read', 'acted', 'expired'])
          .order('created_at', { ascending: false })
          .limit(20);
        return data ?? [];
      } catch { return []; }
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const totalInboxCount = pendingInvites.length + appNotifications.length;
  const totalOldCount = oldInvites.length + oldNotifications.length;
  const [oldExpanded, setOldExpanded] = useState(false);

  const respondToInvite = useCallback(async (inviteId: string, action: 'accepted' | 'declined', eventId?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await supabase.from('plan_invites').update({ status: action, updated_at: new Date().toISOString() }).eq('id', inviteId);
    refetchInvites();
    refetchOldInvites();
    queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
    if (action === 'accepted' && eventId) {
      setShowInvites(false);
      router.push(`/plan/${eventId}`);
    }
  }, [refetchInvites, refetchOldInvites, router, queryClient]);

  const handleNotifAction = useCallback(async (notifId: string, action: 'acted' | 'read', eventId?: string, notifType?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await supabase.from('app_notifications').update({ status: action }).eq('id', notifId);
    refetchNotifs();
    refetchOldNotifs();
    queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
    if (action === 'acted' && eventId) {
      setShowInvites(false);
      if (notifType === 'member_joined' || notifType === 'invite_accepted') {
        router.push(`/(tabs)/chats/${eventId}` as any);
      } else {
        router.push(`/plan/${eventId}`);
      }
    }
  }, [refetchNotifs, refetchOldNotifs, router, queryClient]);

  const isSearching = searchQuery.length > 0;
  const myHandle = myProfile?.handle ?? null;
  const initialLoading = userLoading || (!!userId && profileLoading);

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            <Text style={styles.headerTitleItalic}>Your</Text> People
          </Text>
          <ProfileButton />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          <Text style={styles.headerTitleItalic}>Your</Text> People
        </Text>
        <ProfileButton />
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Search size={18} color={Colors.textLight} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by @handle"
          placeholderTextColor={Colors.textLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </View>
      {!isSearching && (
        <Text style={styles.searchHint}>People can only find you by your @handle</Text>
      )}

      {isSearching ? (
        /* Search results overlay */
        <View style={styles.searchResults}>
          {searchLoading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} style={{ marginTop: 24 }} />
          ) : searchResults.length === 0 ? (
            <Text style={styles.emptySearchText}>{cleanQuery.length < 2 ? 'Type at least 2 characters' : 'No handle found'}</Text>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.searchListContent}
              renderItem={({ item }) => {
                const isFriend = friendIds.has(item.id);
                return (
                  <View style={styles.searchRow}>
                    <View style={styles.searchRowLeft}>
                      {item.profile_photo_url ? (
                        <Image source={{ uri: item.profile_photo_url }} style={styles.searchAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.searchAvatar, styles.avatarFallback]}>
                          <Text style={styles.avatarInitial}>{item.first_name_display?.[0] ?? '?'}</Text>
                        </View>
                      )}
                      <View>
                        <Text style={styles.searchRowName}>{item.first_name_display ?? 'Unknown'}</Text>
                        {item.handle && <Text style={styles.searchRowHandle}>@{item.handle}</Text>}
                      </View>
                    </View>
                    <View style={styles.searchRowActions}>
                      <TouchableOpacity
                        style={[styles.addBtn, isFriend && styles.addedBtn]}
                        onPress={() => !isFriend && addFriend.mutate(item.id)}
                        disabled={isFriend}
                      >
                        <Text style={[styles.addBtnText, isFriend && styles.addedBtnText]}>
                          {isFriend ? 'Added ✓' : 'Add'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleUserMenu(item.id, item.first_name_display ?? 'this person')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.menuBtn}
                      >
                        <MoreHorizontal size={18} color={Colors.textLight} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : (
        <>
          {/* Handle card */}
          <View style={styles.handleCard}>
            {myHandle ? (
              <>
                <Text style={styles.handleLabel}>@{myHandle}</Text>
                <View style={styles.handleBtnRow}>
                  <TouchableOpacity style={styles.shareBtn} onPress={shareHandle}>
                    <Share2 size={16} color={Colors.white} />
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.qrBtn} onPress={() => setShowQr(true)}>
                    <QrCode size={16} color={Colors.terracotta} />
                    <Text style={styles.qrBtnText}>QR Code</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.handleSetLabel}>Set your handle</Text>
                <View style={styles.handleInputWrap}>
                  <Text style={styles.handlePrefix}>@</Text>
                  <TextInput
                    style={styles.handleInput}
                    placeholder="yourname"
                    placeholderTextColor={Colors.textLight}
                    value={handleInput}
                    onChangeText={(t) => setHandleInput(normalizeHandleInput(t))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                  />
                </View>
                {checkingHandle ? (
                  <ActivityIndicator size="small" color={Colors.textLight} style={styles.handleAvailability} />
                ) : handleAvailable === true ? (
                  <Text style={styles.handleAvailable}>Available</Text>
                ) : handleAvailable === false ? (
                  <Text style={styles.handleTaken}>Taken</Text>
                ) : null}
                {handleError && <Text style={styles.handleError}>{handleError}</Text>}
                <TouchableOpacity
                  style={[styles.saveHandleBtn, (savingHandle || checkingHandle || handleAvailable === false || handleAvailable === null) && { opacity: 0.7 }]}
                  onPress={saveHandle}
                  disabled={savingHandle || checkingHandle || handleAvailable === false || handleAvailable === null || handleInput.length < 2}
                >
                  {savingHandle ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.saveHandleBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Friends list */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your People</Text>
            <Text style={styles.sectionCount}> · {friends.length}</Text>
          </View>

          {friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Users size={48} color={Colors.terracotta} />
              <Text style={[styles.emptyTitle, { textAlign: 'center' }]}>Add people here to invite them to your plans.</Text>
              <Text style={styles.emptyHint}>Search by @handle to find people</Text>
            </View>
          ) : (
            <FlatList
              data={friends}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.friendsList}
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.friendRow}
                  onLongPress={() => removeFriend(item)}
                  activeOpacity={0.7}
                >
                  {item.profile_photo_url ? (
                    <Image source={{ uri: item.profile_photo_url }} style={styles.friendAvatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.friendAvatar, styles.avatarFallback]}>
                      <Text style={styles.friendAvatarInitial}>{item.first_name_display?.[0] ?? '?'}</Text>
                    </View>
                  )}
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{item.first_name_display ?? 'Unknown'}</Text>
                    {item.handle && <Text style={styles.friendHandle}>@{item.handle}</Text>}
                  </View>
                  <TouchableOpacity
                    style={styles.inviteBtn}
                    onPress={() => handleInvite(item)}
                    activeOpacity={0.8}
                  >
                    <Send size={14} color={Colors.terracotta} />
                    <Text style={styles.inviteBtnText}>Invite</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}

      {/* Report Modal */}
      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}

      {/* Unified Inbox */}
      <Modal visible={showInvites} transparent animationType="fade">
        <Pressable style={styles.qrOverlay} onPress={() => setShowInvites(false)}>
          <Pressable style={styles.inviteSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.inviteSheetTitle}>Invites and Fun Stuff</Text>
            {totalInboxCount === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Bell size={36} color={Colors.textLight} />
                <Text style={[styles.invitePlanMeta, { marginTop: 12, textAlign: 'center' }]}>
                  {'Invites, waitlist notifications\n& fun updates will show up here'}
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.invitePlanList} bounces={false}>
                {/* Plan invites */}
                {pendingInvites.map((inv: any) => {
                  const sender = inv.profiles;
                  const plan = inv.events;
                  return (
                    <TouchableOpacity
                      key={`inv-${inv.id}`}
                      style={styles.inboxRow}
                      activeOpacity={0.7}
                      onPress={() => {
                        setShowInvites(false);
                        router.push(`/plan/${inv.event_id}` as any);
                      }}
                    >
                      {sender?.profile_photo_url ? (
                        <Image source={{ uri: sender.profile_photo_url }} style={styles.inboxAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.inboxAvatar, styles.inboxAvatarFallback]}>
                          <Send size={16} color={Colors.terracotta} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.invitePlanTitle} numberOfLines={1}>
                          {sender?.first_name_display ?? 'Someone'} invited you
                        </Text>
                        <Text style={styles.inboxPlanName} numberOfLines={1}>{plan.title}</Text>
                        {plan.start_time && (
                          <Text style={styles.invitePlanMeta}>
                            {new Date(plan.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                      </View>
                      <View style={styles.inboxViewBtn}>
                        <Text style={styles.inboxViewBtnText}>View</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* App notifications */}
                {appNotifications.map((notif: any) => {
                  const icon = notif.type === 'waitlist_spot' ? <Clock size={16} color={Colors.terracotta} />
                    : notif.type === 'broadcast' ? <Megaphone size={16} color={Colors.terracotta} />
                    : notif.type === 'member_joined' ? <UserPlus size={16} color={Colors.terracotta} />
                    : notif.type === 'plan_invite' ? <Mail size={16} color={Colors.terracotta} />
                    : notif.type === 'invite_accepted' ? <Check size={16} color={Colors.terracotta} />
                    : <Bell size={16} color={Colors.terracotta} />;
                  const hasAction = (notif.type === 'waitlist_spot' || notif.type === 'member_joined' || notif.type === 'plan_invite' || notif.type === 'invite_accepted') && notif.event_id;
                  const timeLeft = notif.expires_at
                    ? Math.max(0, Math.round((new Date(notif.expires_at).getTime() - Date.now()) / 3600000))
                    : null;
                  return (
                    <View key={`notif-${notif.id}`} style={styles.inboxRow}>
                      <View style={[styles.inboxAvatar, styles.inboxAvatarFallback]}>
                        {icon}
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.invitePlanTitle} numberOfLines={1}>{notif.title}</Text>
                        {notif.body && <Text style={styles.inboxPlanName} numberOfLines={2}>{notif.body}</Text>}
                        {timeLeft !== null && timeLeft > 0 && (
                          <Text style={styles.inboxExpiry}>
                            {timeLeft < 1 ? 'Expires soon' : `${timeLeft}h left to respond`}
                          </Text>
                        )}
                      </View>
                      <View style={styles.inboxActions}>
                        {hasAction && (
                          <TouchableOpacity
                            style={styles.inboxAcceptBtn}
                            onPress={() => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type)}
                          >
                            <Check size={16} color={Colors.white} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.inboxDeclineBtn}
                          onPress={() => handleNotifAction(notif.id, 'read', undefined, notif.type)}
                        >
                          <XCircle size={16} color={Colors.textLight} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                {/* Old Messages */}
                {totalOldCount > 0 && (
                  <>
                    <TouchableOpacity
                      style={styles.oldMessagesHeader}
                      onPress={() => setOldExpanded((v) => !v)}
                      activeOpacity={0.7}
                    >
                      {oldExpanded
                        ? <ChevronDown size={16} color={Colors.textLight} />
                        : <ChevronRight size={16} color={Colors.textLight} />
                      }
                      <Text style={styles.oldMessagesTitle}>
                        Old messages ({totalOldCount})
                      </Text>
                    </TouchableOpacity>

                    {oldExpanded && (
                      <>
                        {oldInvites.map((inv: any) => {
                          const sender = inv.profiles;
                          const plan = inv.events;
                          const statusLabel = inv.status === 'accepted' ? 'Accepted' : 'Declined';
                          return (
                            <View key={`old-inv-${inv.id}`} style={[styles.inboxRow, { opacity: 0.6 }]}>
                              {sender?.profile_photo_url ? (
                                <Image source={{ uri: sender.profile_photo_url }} style={styles.inboxAvatar} contentFit="cover" />
                              ) : (
                                <View style={[styles.inboxAvatar, styles.inboxAvatarFallback]}>
                                  <Send size={16} color={Colors.textLight} />
                                </View>
                              )}
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.invitePlanTitle} numberOfLines={1}>
                                  {sender?.first_name_display ?? 'Someone'} invited you
                                </Text>
                                <Text style={styles.inboxPlanName} numberOfLines={1}>{plan?.title ?? 'a plan'}</Text>
                              </View>
                              <Text style={[styles.oldStatusLabel, inv.status === 'accepted' ? styles.oldStatusAccepted : styles.oldStatusDeclined]}>
                                {statusLabel}
                              </Text>
                            </View>
                          );
                        })}

                        {oldNotifications.map((notif: any) => {
                          const oldIcon = notif.type === 'invite_accepted' ? <Check size={16} color={Colors.textLight} />
                            : notif.type === 'member_joined' ? <UserPlus size={16} color={Colors.textLight} />
                            : notif.type === 'waitlist_spot' ? <Clock size={16} color={Colors.textLight} />
                            : notif.type === 'broadcast' ? <Megaphone size={16} color={Colors.textLight} />
                            : <Bell size={16} color={Colors.textLight} />;
                          const statusLabel = notif.status === 'expired' ? 'Expired' : 'Read';
                          return (
                            <View key={`old-notif-${notif.id}`} style={[styles.inboxRow, { opacity: 0.6 }]}>
                              <View style={[styles.inboxAvatar, styles.inboxAvatarFallback]}>
                                {oldIcon}
                              </View>
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.invitePlanTitle} numberOfLines={1}>{notif.title}</Text>
                                {notif.body && <Text style={styles.inboxPlanName} numberOfLines={2}>{notif.body}</Text>}
                              </View>
                              <Text style={[styles.oldStatusLabel, notif.status === 'expired' ? styles.oldStatusDeclined : styles.oldStatusRead]}>
                                {statusLabel}
                              </Text>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.qrCloseBtn} onPress={() => setShowInvites(false)}>
              <Text style={styles.qrCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Invite Plan Picker */}
      <Modal visible={!!inviteTarget} transparent animationType="fade">
        <Pressable style={styles.qrOverlay} onPress={() => setInviteTarget(null)}>
          <Pressable style={styles.inviteSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.inviteSheetTitle}>
              Invite {inviteTarget?.first_name_display ?? ''} to a plan
            </Text>
            <ScrollView style={styles.invitePlanList} bounces={false}>
              {myActivePlans.map((plan: any) => {
                const isFull = plan.member_count >= plan.max_invites;
                const alreadySent = sentInviteIds.has(plan.id);
                const alreadyAttending = attendingIds.has(plan.id);
                const disabled = isFull || alreadySent || alreadyAttending;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={[styles.invitePlanRow, disabled && styles.invitePlanRowFull]}
                    onPress={() => !disabled && sendInviteLink(plan)}
                    activeOpacity={disabled ? 1 : 0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.invitePlanTitle} numberOfLines={1}>{plan.title}</Text>
                      {plan.start_time && (
                        <Text style={styles.invitePlanMeta}>
                          {new Date(plan.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </Text>
                      )}
                    </View>
                    {alreadyAttending ? (
                      <Text style={styles.invitePlanAttendingLabel}>Attending</Text>
                    ) : alreadySent ? (
                      <Text style={styles.invitePlanSentLabel}>Invited</Text>
                    ) : isFull ? (
                      <Text style={styles.invitePlanFullLabel}>Full</Text>
                    ) : (
                      <Send size={16} color={Colors.terracotta} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.qrCloseBtn} onPress={() => setInviteTarget(null)}>
              <Text style={styles.qrCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* QR Modal */}
      <Modal visible={showQr} transparent animationType="fade">
        <Pressable style={styles.qrOverlay} onPress={() => setShowQr(false)}>
          <Pressable style={styles.qrModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.qrModalTitle}>Scan to add me</Text>
            {myHandle && (
              <QRCode value={`https://washedup.app/u/${myHandle}`} size={180} backgroundColor={Colors.white} />
            )}
            <TouchableOpacity style={styles.qrCloseBtn} onPress={() => setShowQr(false)}>
              <Text style={styles.qrCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  headerTitleItalic: {
    fontFamily: Fonts.displayItalic,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.white,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { position: 'absolute', left: 14 },
  searchInput: {
    flex: 1,
    marginLeft: 28,
    marginRight: 8,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 0,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'left',
  },

  searchResults: { flex: 1 },
  searchListContent: { paddingBottom: 24 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansBold, color: Colors.terracotta },
  searchRowName: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.asphalt },
  searchRowHandle: { fontSize: FontSizes.bodySM, color: Colors.textLight, marginTop: 1 },
  searchRowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuBtn: { padding: 4 },
  addBtn: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sansMedium, color: Colors.white },
  addedBtn: { backgroundColor: Colors.inputBg },
  addedBtnText: { fontSize: FontSizes.bodySM, color: Colors.textLight },

  emptySearchText: { fontSize: FontSizes.bodyLG, color: Colors.textLight, textAlign: 'center', marginTop: 24 },

  handleCard: {
    backgroundColor: Colors.white,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    padding: 16,
  },
  handleLabel: { fontSize: FontSizes.displaySM, fontFamily: Fonts.sansBold, color: Colors.asphalt, marginBottom: 12 },
  handleBtnRow: { flexDirection: 'row', gap: 10 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
  },
  shareBtnText: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.white },
  qrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.terracotta,
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
  },
  qrBtnText: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.terracotta },
  handleSetLabel: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans, color: Colors.textLight, marginBottom: 8 },
  handleInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    marginBottom: 8,
  },
  handlePrefix: { fontSize: FontSizes.bodyLG, color: Colors.textLight, marginLeft: 16 },
  handleInput: {
    flex: 1,
    paddingVertical: 14,
    paddingLeft: 8,
    paddingRight: 16,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  handleAvailability: { marginTop: 6, marginBottom: 4 },
  handleAvailable: { fontSize: FontSizes.caption, color: Colors.successGreen, fontFamily: Fonts.sansMedium, marginTop: 6, marginBottom: 4 },
  handleTaken: { fontSize: FontSizes.caption, color: Colors.errorRed, fontFamily: Fonts.sansMedium, marginTop: 6, marginBottom: 4 },
  handleError: { fontSize: FontSizes.bodySM, color: Colors.errorRed, marginBottom: 8 },
  saveHandleBtn: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveHandleBtnText: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.white },

  sectionHeader: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 8 },
  sectionTitle: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansBold, color: Colors.asphalt },
  sectionCount: { fontSize: FontSizes.bodyMD, color: Colors.textLight },

  friendsList: { paddingBottom: 32 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  friendAvatar: { width: 44, height: 44, borderRadius: 22 },
  friendAvatarFallback: {},
  friendAvatarInitial: { fontSize: FontSizes.displaySM, fontFamily: Fonts.sansBold, color: Colors.terracotta },
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.asphalt },
  friendHandle: { fontSize: FontSizes.bodySM, color: Colors.textLight, marginTop: 1 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 10,
  },
  inviteBtnText: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sansMedium, color: Colors.terracotta },
  searchHint: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sans,
    color: Colors.textLight,
    textAlign: 'center',
    marginBottom: 8,
    marginTop: -4,
  },
  inviteSheet: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    width: '85%',
    maxHeight: '60%',
  },
  inviteSheetTitle: {
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sansBold,
    color: Colors.asphalt,
    marginBottom: 16,
    textAlign: 'center',
  },
  invitePlanList: { maxHeight: 300 },
  invitePlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  invitePlanRowFull: { opacity: 0.45 },
  invitePlanTitle: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansMedium,
    color: Colors.asphalt,
  },
  invitePlanMeta: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sans,
    color: Colors.textLight,
    marginTop: 2,
  },
  invitePlanFullLabel: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sansMedium,
    color: Colors.textLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: Colors.inputBg,
    borderRadius: 6,
    overflow: 'hidden',
  },
  invitePlanSentLabel: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sansMedium,
    color: Colors.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: Colors.parchment,
    borderRadius: 6,
    overflow: 'hidden',
  },
  invitePlanAttendingLabel: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sansMedium,
    color: Colors.successGreen,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: Colors.inputBg,
    borderRadius: 6,
    overflow: 'hidden',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  inviteInboxBtn: {
    position: 'relative',
    padding: 4,
  },
  inviteBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: Colors.terracotta,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  inviteBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.sansBold,
    color: Colors.white,
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  inboxAvatar: { width: 36, height: 36, borderRadius: 18 },
  inboxAvatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inboxExpiry: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.sansMedium,
    color: Colors.errorRed,
    marginTop: 2,
  },
  inboxPlanName: {
    fontSize: FontSizes.bodySM,
    fontFamily: Fonts.sansBold,
    color: Colors.terracotta,
    marginTop: 1,
  },
  inboxActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  inboxAcceptBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxDeclineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxViewBtn: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  inboxViewBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  oldMessagesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  oldMessagesTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
  },
  oldStatusLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  oldStatusAccepted: {
    backgroundColor: `${Colors.terracotta}18`,
    color: Colors.terracotta,
  },
  oldStatusDeclined: {
    backgroundColor: `${Colors.textLight}18`,
    color: Colors.textLight,
  },
  oldStatusRead: {
    backgroundColor: `${Colors.textMedium}14`,
    color: Colors.textMedium,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sans, color: Colors.textMedium },
  emptyHint: { fontSize: FontSizes.bodyMD, color: Colors.terracotta, fontFamily: Fonts.sansMedium },

  qrOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrModal: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  qrModalTitle: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.asphalt, marginBottom: 16 },
  qrCloseBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
  qrCloseBtnText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.terracotta },
});
