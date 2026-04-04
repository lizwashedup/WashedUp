import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { MoreHorizontal, QrCode, Search, Send, Share2, UserPlus, Users, X } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Keyboard,
    Modal,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandedAlert } from '../../../components/BrandedAlert';
import MiniProfileCard from '../../../components/MiniProfileCard';
import ProfileButton from '../../../components/ProfileButton';
import { ReportModal } from '../../../components/modals/ReportModal';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBlock } from '../../../hooks/useBlock';
import { checkContent } from '../../../lib/contentFilter';
import { supabase } from '../../../lib/supabase';

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
  const [showHandlePrompt, setShowHandlePrompt] = useState(false);
  const [friendToRemove, setFriendToRemove] = useState<Friend | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const [userMenuTarget, setUserMenuTarget] = useState<{ id: string; name: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Current user
  const { data: userId, isLoading: userLoading } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  // Debounced handle availability check (500ms)
  React.useEffect(() => {
    const clean = handleInput.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 2) {
      setHandleAvailable(null);
      return;
    }
    const t = setTimeout(async () => {
      setCheckingHandle(true);
      let query = supabase
        .from('profiles')
        .select('id')
        .eq('handle', clean);
      // Exclude the current user so they can reclaim their own handle
      if (userId) query = query.neq('id', userId);
      const { data } = await query.maybeSingle();
      setHandleAvailable(!data);
      setCheckingHandle(false);
    }, 500);
    return () => clearTimeout(t);
  }, [handleInput, userId]);

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

  // One-time handle prompt for users who haven't set one yet
  React.useEffect(() => {
    if (!userId || !myProfile) return;
    if (myProfile.handle) return; // already has a handle
    const key = `has_seen_handle_prompt_${userId}`;
    AsyncStorage.getItem(key).then((seen) => {
      if (!seen) setShowHandlePrompt(true);
    }).catch(() => {});
  }, [userId, myProfile]);

  const dismissHandlePrompt = useCallback(async () => {
    setShowHandlePrompt(false);
    if (userId) {
      await AsyncStorage.setItem(`has_seen_handle_prompt_${userId}`, '1');
    }
  }, [userId]);

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

  const filteredFriends = useMemo(() => friends.filter((f) => !blockedSet.has(f.friend_id)), [friends, blockedSet]);

  // Friend IDs set for O(1) lookup
  const friendIds = useMemo(() => new Set(filteredFriends.map((f) => f.friend_id)), [filteredFriends]);

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
        setAlertInfo({ title: 'Already connected', message: 'You are already connected with this person.' });
      } else {
        setAlertInfo({ title: 'Could not add', message: err?.message ?? 'Please try again.' });
      }
    },
  });

  const removeFriend = useCallback(
    (friend: Friend) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFriendToRemove(friend);
    },
    [],
  );

  const confirmRemoveFriend = useCallback(async () => {
    if (!userId || !friendToRemove) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await supabase.rpc('remove_friend', { p_friend_id: friendToRemove.friend_id });
      queryClient.invalidateQueries({ queryKey: ['friends', userId] });
    } catch {
      // Silently fail — the user can try again
    }
    setFriendToRemove(null);
  }, [userId, friendToRemove, queryClient]);

  // Save handle
  const saveHandle = useCallback(async () => {
    const raw = handleInput.trim().toLowerCase();
    const v = validateHandle(raw);
    if (!v.ok) {
      setHandleError(v.error ?? 'Invalid handle');
      return;
    }
    const filter = checkContent(raw);
    if (!filter.ok) {
      setHandleError('That handle is not allowed.');
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
      setAlertInfo({ title: 'No active plans', message: 'Post a plan first, then invite your people.' });
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
          setAlertInfo({ title: 'Already invited', message: `You already invited ${name} to "${plan.title}".` });
          return;
        }
        throw error;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAlertInfo({ title: 'Invite sent!', message: `You invited ${name} to "${plan.title}"` });
    } catch (e: any) {
      setAlertInfo({ title: 'Could not send invite', message: e?.message ?? 'Something went wrong. Try again.' });
    }
  }, [inviteTarget, userId]);

  const { blockUser } = useBlock();
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  const handleUserMenu = useCallback((targetId: string, targetName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUserMenuTarget({ id: targetId, name: targetName });
  }, []);

  const router = useRouter();

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
                      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMiniProfileUserId(item.id); }}>
                        {item.profile_photo_url ? (
                          <Image source={{ uri: item.profile_photo_url }} style={styles.searchAvatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.searchAvatar, styles.avatarFallback]}>
                            <Text style={styles.avatarInitial}>{item.first_name_display?.[0] ?? '?'}</Text>
                          </View>
                        )}
                      </Pressable>
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
            <Text style={styles.sectionCount}> · {filteredFriends.length}</Text>
          </View>

          {filteredFriends.length === 0 ? (
            <View style={styles.emptyState}>
              <Users size={48} color={Colors.terracotta} />
              <Text style={[styles.emptyTitle, { textAlign: 'center' }]}>Add people here to invite them to your plans.</Text>
              <Text style={styles.emptyHint}>Search by @handle to find people</Text>
            </View>
          ) : (
            <FlatList
              data={filteredFriends}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.friendsList}
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.friendRow}
                  onLongPress={() => removeFriend(item)}
                  activeOpacity={0.7}
                >
                  <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMiniProfileUserId(item.friend_id); }}>
                    {item.profile_photo_url ? (
                      <Image source={{ uri: item.profile_photo_url }} style={styles.friendAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.friendAvatar, styles.avatarFallback]}>
                        <Text style={styles.friendAvatarInitial}>{item.first_name_display?.[0] ?? '?'}</Text>
                      </View>
                    )}
                  </Pressable>
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

      {/* One-time handle prompt */}
      <Modal visible={showHandlePrompt} transparent animationType="fade">
        <Pressable style={styles.handlePromptOverlay} onPress={dismissHandlePrompt}>
          <Pressable style={styles.handlePromptCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handlePromptIconWrap}>
              <UserPlus size={32} color={Colors.terracotta} />
            </View>
            <Text style={styles.handlePromptTitle}>Create your WashedUp handle</Text>
            <Text style={styles.handlePromptBody}>
              Your handle is how people find you and invite you to things after you've met. Set one below to get started.
            </Text>
            <TouchableOpacity style={styles.handlePromptBtn} onPress={dismissHandlePrompt}>
              <Text style={styles.handlePromptBtnText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <BrandedAlert
        visible={!!friendToRemove}
        title="Remove from Your People"
        message={`Remove ${friendToRemove?.first_name_display ?? 'this person'} from Your People?`}
        buttons={[
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: confirmRemoveFriend },
        ]}
        onClose={() => setFriendToRemove(null)}
      />

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message ?? ''}
        buttons={[{ text: 'OK' }]}
        onClose={() => setAlertInfo(null)}
      />

      <MiniProfileCard
        visible={!!miniProfileUserId}
        userId={miniProfileUserId}
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setReportTarget({ id: uid, name: uname });
          setShowReport(true);
        }}
        onBlock={(uid, uname) => {
          blockUser(uid, uname, () => {
            queryClient.invalidateQueries({ queryKey: ['profile-search'] });
            queryClient.invalidateQueries({ queryKey: ['friends', userId] });
          });
        }}
      />

      <BrandedAlert
        visible={!!userMenuTarget}
        title={userMenuTarget?.name ?? ''}
        buttons={[
          {
            text: `Report ${userMenuTarget?.name ?? ''}`,
            onPress: () => {
              if (userMenuTarget) {
                setReportTarget({ id: userMenuTarget.id, name: userMenuTarget.name });
                setShowReport(true);
              }
            },
          },
          {
            text: `Block ${userMenuTarget?.name ?? ''}`,
            style: 'destructive',
            onPress: () => {
              if (userMenuTarget) {
                blockUser(userMenuTarget.id, userMenuTarget.name, () => {
                  queryClient.invalidateQueries({ queryKey: ['profile-search'] });
                  queryClient.invalidateQueries({ queryKey: ['friends', userId] });
                });
              }
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]}
        onClose={() => setUserMenuTarget(null)}
      />
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
    fontSize: FontSizes.displayLG,
    fontWeight: '700',
    color: '#2C1810',
  },
  headerTitleItalic: {
    fontWeight: '700',
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
  removeBtn: {
    marginLeft: 10,
    padding: 2,
  },
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
    borderRadius: 20,
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
    fontSize: FontSizes.micro,
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
  waitlistActions: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 10,
  },
  claimSpotBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  claimSpotText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  cantGoBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'center' as const,
  },
  cantGoText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
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
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  qrModalTitle: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.asphalt, marginBottom: 16 },
  qrCloseBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
  qrCloseBtnText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.terracotta },

  handlePromptOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handlePromptCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    marginHorizontal: 32,
    alignItems: 'center',
  },
  handlePromptIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: `${Colors.terracotta}14`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  handlePromptTitle: {
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sansBold,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 10,
  },
  handlePromptBody: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sans,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  handlePromptBtn: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 12,
    paddingHorizontal: 36,
    borderRadius: 14,
  },
  handlePromptBtnText: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansMedium,
    color: Colors.white,
  },
});
