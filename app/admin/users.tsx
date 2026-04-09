import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticWarning, hapticSuccess } from '../../lib/haptics';
import { ArrowLeft, Search, UserX } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';

interface AdminUser {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  city: string | null;
  created_at: string;
  onboarding_status: string | null;
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid !== null && !isAdmin(uid)) router.back();
    });
  }, [router]);

  const { data: users = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name_display, profile_photo_url, city, created_at, onboarding_status')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.first_name_display ?? '').toLowerCase().includes(q) ||
      (u.city ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const handleDeleteAndBan = (user: AdminUser) => {
    const name = user.first_name_display ?? 'this user';
    Alert.alert(
      `Delete & Ban ${name}?`,
      `This will permanently delete their account, all their plans and messages, and ban their email so they cannot re-register. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete & Ban',
          style: 'destructive',
          onPress: async () => {
            setRemoving(user.id);
            hapticWarning();
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) throw new Error('Not authenticated');

              const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-manage-user', {
                body: { action: 'delete_and_ban', targetUserId: user.id },
              });
              if (fnError) throw fnError;
              if (fnData?.error) throw new Error(fnData.error);

              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['admin-users'] });
              Alert.alert('Done', `${name} has been deleted and banned.`);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not remove user. Try again.');
            } finally {
              setRemoving(null);
            }
          },
        },
      ],
    );
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Users</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.warmGray} strokeWidth={2} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or city…"
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.countLabel}>
            {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
          </Text>

          {filtered.map((user) => (
            <View key={user.id} style={styles.card}>
              <Image
                source={user.profile_photo_url ? { uri: user.profile_photo_url } : undefined}
                style={styles.avatar}
                contentFit="cover"
              />
              <View style={styles.cardInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user.first_name_display ?? 'Unknown'}
                </Text>
                <Text style={styles.userMeta} numberOfLines={1}>
                  {[user.city, formatDate(user.created_at)].filter(Boolean).join(' · ')}
                </Text>
                {user.onboarding_status && user.onboarding_status !== 'complete' && (
                  <Text style={styles.statusBadge}>{user.onboarding_status}</Text>
                )}
              </View>
              <TouchableOpacity
                style={[styles.banBtn, removing === user.id && { opacity: 0.5 }]}
                onPress={() => handleDeleteAndBan(user)}
                disabled={removing === user.id}
                hitSlop={8}
              >
                {removing === user.id ? (
                  <ActivityIndicator size="small" color={Colors.errorRed} />
                ) : (
                  <UserX size={18} color={Colors.errorRed} strokeWidth={2} />
                )}
              </TouchableOpacity>
            </View>
          ))}

          {filtered.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.asphalt },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: { flexShrink: 0 },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  list: { flex: 1 },
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },

  countLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginBottom: 4,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBg,
    flexShrink: 0,
  },
  cardInfo: { flex: 1, gap: 2 },
  userName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  userMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  statusBadge: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.goldenAmber,
    marginTop: 2,
  },

  banBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.errorBgLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
});
