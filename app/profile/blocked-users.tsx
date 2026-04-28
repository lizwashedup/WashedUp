import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { BrandedAlert } from '../../components/BrandedAlert';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

type BlockedProfile = {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  city: string | null;
};

const PRIVACY_EXPLAINER =
  "blocked people can't see your plans, and you can't see theirs.";

export default function BlockedUsersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: blocked = [], isLoading } = useQuery({
    queryKey: ['blocked-users-list', userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<BlockedProfile[]> => {
      const { data: meRow } = await supabase
        .from('profiles')
        .select('blocked_users')
        .eq('id', userId)
        .single();
      const ids: string[] = meRow?.blocked_users ?? [];
      if (ids.length === 0) return [];
      const { data: rows } = await supabase
        .from('profiles')
        .select('id, first_name_display, profile_photo_url, city')
        .in('id', ids);
      return (rows ?? []).filter((r): r is BlockedProfile => !!r);
    },
  });

  const [confirmTarget, setConfirmTarget] =
    useState<{ id: string; name: string } | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const handleUnblock = useCallback(async () => {
    if (!confirmTarget || !userId || working) return;
    const { id: blockedId } = confirmTarget;
    setWorking(true);
    try {
      const { data: meRow } = await supabase
        .from('profiles')
        .select('blocked_users')
        .eq('id', userId)
        .single();
      const current: string[] = meRow?.blocked_users ?? [];
      const next = current.filter((uid) => uid !== blockedId);
      if (next.length !== current.length) {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ blocked_users: next })
          .eq('id', userId);
        if (updErr) throw updErr;
      }
      queryClient.setQueryData<BlockedProfile[]>(
        ['blocked-users-list', userId],
        (prev) => (prev ?? []).filter((p) => p.id !== blockedId),
      );
      queryClient.invalidateQueries({ queryKey: ['blocked-users-list'] });
      queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['events', 'members'] });
      queryClient.invalidateQueries({ queryKey: ['event-plans'] });
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['profile-blocked'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['profile-search'] });
      queryClient.invalidateQueries({ queryKey: ['scene-events'] });
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['wishlists'] });
      setConfirmTarget(null);
    } catch {
      setConfirmTarget(null);
      setTimeout(() => setErrorOpen(true), 250);
    } finally {
      setWorking(false);
    }
  }, [confirmTarget, userId, working, queryClient]);

  const renderRow = (row: BlockedProfile, isLast: boolean) => {
    const name = row.first_name_display ?? 'someone';
    return (
      <View key={row.id} style={[styles.row, !isLast && styles.rowDivider]}>
        {row.profile_photo_url ? (
          <Image
            source={{ uri: row.profile_photo_url }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(row.first_name_display ?? '?')[0]?.toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name.toLowerCase()}
          </Text>
          {row.city ? (
            <Text style={styles.rowCity} numberOfLines={1}>
              {row.city.toLowerCase()}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.unblockBtn}
          onPress={() => setConfirmTarget({ id: row.id, name })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.6}
        >
          <Text style={styles.unblockBtnText}>unblock</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const showLoading = !userId || isLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.asphalt} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>blocked users</Text>
        <View style={{ width: 40 }} />
      </View>

      {showLoading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      ) : blocked.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>you haven't blocked anyone.</Text>
          <Text style={styles.emptySubtitle}>{PRIVACY_EXPLAINER}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.privacyExplainer}>{PRIVACY_EXPLAINER}</Text>
          <View style={styles.list}>
            {blocked.map((row, i) => renderRow(row, i === blocked.length - 1))}
          </View>
        </ScrollView>
      )}

      <BrandedAlert
        visible={!!confirmTarget}
        title={
          confirmTarget
            ? `unblock ${confirmTarget.name.toLowerCase()}?`
            : ''
        }
        message={
          confirmTarget
            ? `they'll be able to see and join your plans again.`
            : undefined
        }
        buttons={[
          { text: 'cancel', style: 'cancel' },
          {
            text: 'unblock',
            style: 'destructive',
            onPress: () => {
              void handleUnblock();
            },
          },
        ]}
        onClose={() => {
          if (!working) setConfirmTarget(null);
        }}
      />

      <BrandedAlert
        visible={errorOpen}
        title="something went wrong"
        message="could not unblock. please try again."
        buttons={[{ text: 'ok' }]}
        onClose={() => setErrorOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.warmGray,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.warmGray,
    textAlign: 'center',
    lineHeight: 20,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  privacyExplainer: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  list: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBg,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.warmGray,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  rowCity: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
  },
  unblockBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  unblockBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});
