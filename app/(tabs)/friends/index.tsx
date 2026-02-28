import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Keyboard,
  Share,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Users, QrCode, Share2, X } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import ProfileButton from '../../../components/ProfileButton';
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
  const { data: userId } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  });

  // My profile (for handle)
  const { data: myProfile, refetch: refetchProfile } = useQuery({
    queryKey: ['my-profile', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('id, handle')
        .eq('id', userId)
        .single();
      return data as { id: string; handle: string | null } | null;
    },
    enabled: !!userId,
  });

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

  // Search results
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['profile-search', debouncedQuery, userId],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!userId || debouncedQuery.length < 1) return [];
      const pattern = `%${debouncedQuery}%`;
      const { data, error } = await supabase
        .from('profiles_public')
        .select('id, first_name_display, profile_photo_url, handle')
        .or(`first_name_display.ilike.${encodeURIComponent(pattern)},handle.ilike.${encodeURIComponent(pattern)}`)
        .neq('id', userId)
        .limit(20);
      if (error) return [];
      return (data ?? []) as SearchResult[];
    },
    enabled: !!userId && debouncedQuery.length >= 1,
  });

  useFocusEffect(
    useCallback(() => {
      refetchFriends();
      refetchProfile();
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
        message: `Add me on WashedUp — @${h} washedup.app`,
        title: 'Add me on WashedUp',
      });
    } catch {}
  }, [myProfile?.handle]);

  const isSearching = searchQuery.length > 0;
  const myHandle = myProfile?.handle ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your People</Text>
        <ProfileButton />
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Search size={18} color="#999999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or @handle"
          placeholderTextColor="#C8BEB5"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color="#999999" />
          </TouchableOpacity>
        )}
      </View>

      {isSearching ? (
        /* Search results overlay */
        <View style={styles.searchResults}>
          {searchLoading ? (
            <ActivityIndicator size="small" color="#C4652A" style={{ marginTop: 24 }} />
          ) : searchResults.length === 0 ? (
            <Text style={styles.emptySearchText}>No one found</Text>
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
                    <TouchableOpacity
                      style={[styles.addBtn, isFriend && styles.addedBtn]}
                      onPress={() => !isFriend && addFriend.mutate(item.id)}
                      disabled={isFriend}
                    >
                      <Text style={[styles.addBtnText, isFriend && styles.addedBtnText]}>
                        {isFriend ? 'Added ✓' : 'Add'}
                      </Text>
                    </TouchableOpacity>
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
                    <Share2 size={16} color="#FFFFFF" />
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.qrBtn} onPress={() => setShowQr(true)}>
                    <QrCode size={16} color="#C4652A" />
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
                    placeholderTextColor="#C8BEB5"
                    value={handleInput}
                    onChangeText={(t) => setHandleInput(normalizeHandleInput(t))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                  />
                </View>
                {checkingHandle ? (
                  <ActivityIndicator size="small" color="#999999" style={styles.handleAvailability} />
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
                    <ActivityIndicator size="small" color="#FFFFFF" />
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
              <Users size={48} color="#C4652A" />
              <Text style={[styles.emptyTitle, { textAlign: 'center' }]}>This is where you can add people you might want to invite first to your plans.</Text>
              <Text style={styles.emptySub}>
                If you know anyone on WashedUp, or after your first plan add people you want to spend time with again!
              </Text>
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
                  <Text style={styles.removeHint}>Long-press to remove</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}

      {/* QR Modal */}
      <Modal visible={showQr} transparent animationType="fade">
        <Pressable style={styles.qrOverlay} onPress={() => setShowQr(false)}>
          <Pressable style={styles.qrModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.qrModalTitle}>Scan to add me</Text>
            {myHandle && (
              <QRCode value={`https://washedup.app/u/${myHandle}`} size={180} backgroundColor="#FFFFFF" />
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
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#C4652A',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#F0E6D3',
  },
  searchIcon: { position: 'absolute', left: 14 },
  searchInput: {
    flex: 1,
    marginLeft: 28,
    marginRight: 8,
    fontSize: 16,
    color: '#1A1A1A',
    paddingVertical: 0,
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
    borderBottomColor: '#F0E6D3',
  },
  searchRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: '#C4652A' },
  searchRowName: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  searchRowHandle: { fontSize: 13, color: '#888888', marginTop: 1 },
  addBtn: {
    backgroundColor: '#C4652A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  addedBtn: { backgroundColor: '#F0E6D3' },
  addedBtnText: { fontSize: 13, color: '#888888' },

  emptySearchText: { fontSize: 15, color: '#888888', textAlign: 'center', marginTop: 24 },

  handleCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 14,
    padding: 16,
  },
  handleLabel: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  handleBtnRow: { flexDirection: 'row', gap: 10 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#C4652A',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
  },
  shareBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  qrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C4652A',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 16,
  },
  qrBtnText: { fontSize: 14, fontWeight: '600', color: '#C4652A' },
  handleSetLabel: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 },
  handleInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F0E6D3',
    borderRadius: 14,
    marginBottom: 8,
  },
  handlePrefix: { fontSize: 16, color: '#888888', marginLeft: 16 },
  handleInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    fontSize: 16,
    color: '#1A1A1A',
  },
  handleAvailability: { marginTop: 6, marginBottom: 4 },
  handleAvailable: { fontSize: 12, color: '#16A34A', fontWeight: '600', marginTop: 6, marginBottom: 4 },
  handleTaken: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginTop: 6, marginBottom: 4 },
  handleError: { fontSize: 13, color: '#E53935', marginBottom: 8 },
  saveHandleBtn: {
    backgroundColor: '#C4652A',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveHandleBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  sectionHeader: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  sectionCount: { fontSize: 14, color: '#888888' },

  friendsList: { paddingBottom: 32 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  friendAvatar: { width: 44, height: 44, borderRadius: 22 },
  friendAvatarFallback: {},
  friendAvatarInitial: { fontSize: 18, fontWeight: '700', color: '#C4652A' },
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  friendHandle: { fontSize: 13, color: '#888888', marginTop: 1 },
  removeHint: { fontSize: 11, color: '#C8BEB5' },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  emptySub: { fontSize: 15, color: '#888888', textAlign: 'center', lineHeight: 22 },
  emptyHint: { fontSize: 14, color: '#C4652A', fontWeight: '500' },

  qrOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  qrModalTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 16 },
  qrCloseBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
  qrCloseBtnText: { fontSize: 15, fontWeight: '600', color: '#C4652A' },
});
