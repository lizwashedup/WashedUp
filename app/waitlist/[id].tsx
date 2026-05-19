// Waitlist Exceptions — creator manager (Phase 2).
//
// FIFO list: only the next eligible waitlister is shown in the clear with a
// Grant action. Everyone behind them is blurred (avatar + name masked) so the
// creator invites in order rather than shopping the list. People already let
// in via an exception are listed for context. Backend (Phase 1) is live and
// frozen; this screen only calls the existing RPCs.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, User } from 'lucide-react-native';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  fetchWaitlistManager,
  grantWaitlistException,
  closeWaitlist,
  reopenWaitlist,
  waitlistAlertMessage,
  isStaleOrderError,
  type WaitlistManagerRow,
} from '../../lib/waitlistExceptions';
import { WAITLIST_MANAGER_KEY } from '../../constants/QueryKeys';
import { BrandedAlert } from '../../components/BrandedAlert';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

type ListItem =
  | { t: 'section'; key: string; label: string }
  | { t: 'wl'; key: string; row: WaitlistManagerRow; isNext: boolean; isHintRow: boolean }
  | { t: 'acc'; key: string; row: WaitlistManagerRow };

export default function WaitlistManagerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: WAITLIST_MANAGER_KEY(id),
    queryFn: () => fetchWaitlistManager(id),
    enabled: !!id,
    staleTime: 30_000,
    // The 30s staleTime keeps the shared plan-detail "Waitlist (N)" count
    // cheap, but this screen must always open on fresh state (a slot may have
    // been refunded or a new person may have asked to join since last view).
    refetchOnMount: 'always',
  });

  const slotsUsed = data?.slotsUsed ?? 0;
  const closed = data?.closed ?? false;
  const capReached = slotsUsed >= 3;

  const { waitlist, accepted, nextEligibleUserId, listData } = useMemo(() => {
    const rows = data?.rows ?? [];
    const wl = rows
      .filter((r) => r.kind === 'waitlist')
      .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));
    const acc = rows.filter((r) => r.kind === 'accepted');
    const nextId =
      wl.find(
        (r) => r.exception_status === 'waiting' || r.exception_status === 'expired',
      )?.user_id ?? null;
    const items: ListItem[] = [];
    if (wl.length > 0) {
      items.push({ t: 'section', key: 'sec-waiting', label: 'Waiting' });
      // Hint goes on the first still-masked waiter (first 'waiting' row that
      // isn't the next-eligible), wherever it lands among interleaved
      // already-acted rows.
      let hintAssigned = false;
      wl.forEach((row) => {
        const isNext = row.user_id === nextId;
        const isMaskedWaiter = !isNext && row.exception_status === 'waiting';
        const isHintRow = isMaskedWaiter && !hintAssigned;
        if (isHintRow) hintAssigned = true;
        items.push({ t: 'wl', key: `wl-${row.user_id}`, row, isNext, isHintRow });
      });
    }
    if (acc.length > 0) {
      items.push({ t: 'section', key: 'sec-accepted', label: 'In the plan' });
      acc.forEach((row) =>
        items.push({ t: 'acc', key: `acc-${row.user_id}`, row }),
      );
    }
    return { waitlist: wl, accepted: acc, nextEligibleUserId: nextId, listData: items };
  }, [data?.rows]);

  const grantMutation = useMutation({
    mutationFn: (userId: string) => grantWaitlistException(id, userId),
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(id) });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] });
    },
    onError: (e) => {
      setAlertInfo({ title: 'Hmm', message: waitlistAlertMessage(e, 'Could not save the spot. Try again.') });
      if (isStaleOrderError(e)) refetch();
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => (closed ? reopenWaitlist(id) : closeWaitlist(id)),
    onSuccess: () => {
      hapticLight();
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(id) });
    },
    onError: (e) => {
      setAlertInfo({ title: 'Hmm', message: waitlistAlertMessage(e) });
    },
  });

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/plan/${id}` as any);
  }, [id]);

  const Header = (
    <View style={s.headerCard}>
      <View style={s.slotRow}>
        <Text style={s.slotCount}>{slotsUsed} / 3</Text>
        <Text style={s.slotLabel}>exception spots used</Text>
      </View>
      <Text style={s.slotCaption}>
        Exception spots let you pull people off the waitlist into a full plan.
      </Text>
      {capReached && (
        <Text style={s.capWarn}>All 3 spots used. You can still reopen one if someone passes.</Text>
      )}
      {!capReached && !closed && waitlist.length > 0 && !nextEligibleUserId && (
        <Text style={s.slotCaption}>
          Everyone waiting already has an invite out or has responded. Nothing to do right now.
        </Text>
      )}
      <TouchableOpacity
        style={s.closeBtn}
        onPress={() => closeMutation.mutate()}
        disabled={closeMutation.isPending}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ busy: closeMutation.isPending }}
        accessibilityLabel={closed ? 'Reopen the waitlist' : 'Close the waitlist'}
      >
        <Text style={s.closeBtnText}>
          {closeMutation.isPending
            ? (closed ? 'Reopening…' : 'Closing…')
            : (closed ? 'Reopen waitlist' : 'Close waitlist')}
        </Text>
      </TouchableOpacity>
      <Text style={s.closeCaption}>
        {closed
          ? 'Closed for new exception invites. People can still join the waitlist.'
          : 'Closing stops new exception invites. People can still join the waitlist.'}
      </Text>
    </View>
  );

  function renderRow({ item }: { item: ListItem }) {
    if (item.t === 'section') {
      return <Text style={s.sectionHeader}>{item.label}</Text>;
    }

    if (item.t === 'acc') {
      const r = item.row;
      return (
        <View style={s.row}>
          <Avatar photo={r.photo} blurred={false} />
          <View style={s.rowBody}>
            <Text style={s.rowName} numberOfLines={1}>{r.first_name}</Text>
            <Text style={s.rowContext} numberOfLines={1}>Joined the plan</Text>
          </View>
          <View style={s.pillJoined}>
            <Text style={s.pillJoinedText}>Joined</Text>
          </View>
        </View>
      );
    }

    const { row, isNext, isHintRow } = item;

    if (isNext) {
      const granting =
        grantMutation.isPending && grantMutation.variables === row.user_id;
      const grantEnabled = !capReached && !closed && !grantMutation.isPending;
      return (
        <View style={[s.row, s.nextRow]}>
          <Avatar photo={row.photo} blurred={false} />
          <View style={s.rowBody}>
            <Text style={s.rowName} numberOfLines={1}>{row.first_name}</Text>
            {!!row.context && (
              <Text style={s.rowContext} numberOfLines={1}>{row.context}</Text>
            )}
            {row.exception_status === 'expired' && (
              <Text style={s.rowMutedNote}>Their last invite expired. You can invite them again.</Text>
            )}
          </View>
          <TouchableOpacity
            style={[s.grantBtn, !grantEnabled && s.grantBtnDisabled]}
            disabled={!grantEnabled}
            onPress={() => grantMutation.mutate(row.user_id)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: !grantEnabled, busy: granting }}
            accessibilityLabel={`Save ${row.first_name} a spot in the plan`}
          >
            {granting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={[s.grantBtnText, !grantEnabled && s.grantBtnTextDisabled]}>
                Save them a spot
              </Text>
            )}
          </TouchableOpacity>
        </View>
      );
    }

    // Already acted on (invited / passed / expired / joined): the creator has
    // seen this person, so FIFO privacy no longer applies. Show them clearly
    // with their status pill for a full picture. No Grant (not next in line).
    if (row.exception_status !== 'waiting') {
      return (
        <View style={s.row}>
          <Avatar photo={row.photo} blurred={false} />
          <View style={s.rowBody}>
            <Text style={s.rowName} numberOfLines={1}>{row.first_name}</Text>
            {!!row.context && (
              <Text style={s.rowContext} numberOfLines={1}>{row.context}</Text>
            )}
          </View>
          <StatusPill status={row.exception_status} />
        </View>
      );
    }

    // Unseen waiter behind the next person: identity masked to keep the
    // creator inviting in FIFO order rather than shopping the list.
    return (
      <View style={s.row}>
        <Avatar photo={row.photo} blurred />
        <View style={s.rowBody}>
          <View style={[s.maskBar, { width: '58%' }]} />
          <View style={[s.maskBar, s.maskBarSm, { width: '82%' }]} />
          {isHintRow && (
            <Text style={s.hintText}>Invite the person above first.</Text>
          )}
        </View>
      </View>
    );
  }

  // ── Error / loading states ────────────────────────────────────────────────
  const errMsg = String((error as { message?: unknown } | null)?.message ?? '');
  const isAuthErr = errMsg.includes('not_authorized') || errMsg.includes('not_found');

  if (isError && isAuthErr) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <TopBar onBack={goBack} />
        <View style={s.centered}>
          <Text style={s.emptyTitle}>
            {errMsg.includes('not_found')
              ? "This plan isn't available anymore."
              : 'Only the plan creator can manage the waitlist.'}
          </Text>
          <TouchableOpacity style={s.goBackBtn} onPress={goBack} activeOpacity={0.7}>
            <Text style={s.goBackBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    // Only the top edge here: the FlatList contentContainer adds the bottom
    // safe-area inset itself, so including 'bottom' would double-pad it.
    <SafeAreaView style={s.container} edges={['top']}>
      <TopBar onBack={goBack} />
      {isLoading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : isError ? (
        <View style={s.centered}>
          <Text style={s.emptyTitle}>We couldn't load the waitlist.</Text>
          <TouchableOpacity style={s.goBackBtn} onPress={() => refetch()} activeOpacity={0.7}>
            <Text style={s.goBackBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(it) => it.key}
          renderItem={renderRow}
          ListHeaderComponent={Header}
          ListFooterComponent={
            waitlist.length === 0 ? (
              <View style={s.emptyBlock}>
                <Text style={s.emptyTitle}>No one's waiting yet.</Text>
                <Text style={s.emptyBody}>
                  When someone asks to join this full plan, they'll show up here and
                  you can save them a spot.
                </Text>
                {closed && (
                  <Text style={s.emptyBody}>Your waitlist is closed for new invites.</Text>
                )}
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={Colors.terracotta}
              colors={[Colors.terracotta]}
            />
          }
        />
      )}
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.topBar}>
      <TouchableOpacity
        onPress={onBack}
        style={s.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ArrowLeft size={22} color={Colors.darkWarm} strokeWidth={2} />
      </TouchableOpacity>
      <Text style={s.topTitle}>Waitlist</Text>
      <View style={s.backBtn} />
    </View>
  );
}

function Avatar({ photo, blurred }: { photo: string | null; blurred: boolean }) {
  if (!photo) {
    return (
      <View style={[s.avatar, s.avatarFallback]}>
        <User size={18} color={Colors.tertiary} strokeWidth={2} />
      </View>
    );
  }
  if (blurred) {
    // RN blurRadius is reliable on iOS but weak/inconsistent on Android, so it
    // cannot be the only thing hiding a not-next waitlister's face. Layer an
    // opaque scrim + a neutral silhouette on top so identity is masked the
    // same way on both platforms regardless of blur fidelity.
    return (
      <ImageBackground
        source={{ uri: photo }}
        style={s.avatar}
        imageStyle={s.avatarImg}
        blurRadius={14}
      >
        <View style={s.avatarScrim}>
          <User size={18} color={Colors.tertiary} strokeWidth={2} />
        </View>
      </ImageBackground>
    );
  }
  return <Image source={{ uri: photo }} style={s.avatar} contentFit="cover" />;
}

function StatusPill({ status }: { status: WaitlistManagerRow['exception_status'] }) {
  if (status === 'invited') {
    return (
      <View style={s.pillInvited}>
        <Text style={s.pillInvitedText}>Invited</Text>
      </View>
    );
  }
  if (status === 'declined') {
    return (
      <View style={s.pillMuted}>
        <Text style={s.pillMutedText}>Passed</Text>
      </View>
    );
  }
  if (status === 'expired') {
    return (
      <View style={s.pillMuted}>
        <Text style={s.pillMutedText}>Invite expired</Text>
      </View>
    );
  }
  if (status === 'accepted') {
    return (
      <View style={s.pillJoined}>
        <Text style={s.pillJoinedText}>Joined</Text>
      </View>
    );
  }
  return null;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dividerWarm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  goBackBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goBackBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  headerCard: {
    backgroundColor: Colors.cardBg,
    margin: 16,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  slotRow: { flexDirection: 'row', alignItems: 'baseline' },
  slotCount: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.terracotta,
  },
  slotLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    marginLeft: 8,
  },
  slotCaption: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 8,
    lineHeight: 18,
  },
  capWarn: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.errorBrand,
    marginTop: 8,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingVertical: 4,
  },
  closeBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  closeCaption: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 4,
  },

  sectionHeader: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 20,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dividerWarm,
  },
  nextRow: { backgroundColor: Colors.warmTint },
  rowBody: { flex: 1, marginLeft: 12 },
  rowName: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  rowContext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  rowMutedNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 2,
  },
  hintText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 6,
  },

  avatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: Colors.inputBg },
  avatarImg: { borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarScrim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    backgroundColor: Colors.overlayWhiteLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  maskBar: {
    height: 13,
    borderRadius: 6,
    backgroundColor: Colors.inputBg,
  },
  maskBarSm: { height: 10, marginTop: 7 },

  grantBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  grantBtnDisabled: { backgroundColor: Colors.inputBg, shadowOpacity: 0 },
  grantBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  grantBtnTextDisabled: { color: Colors.tertiary },

  pillInvited: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillInvitedText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  pillMuted: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillMutedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
  },
  pillJoined: {
    backgroundColor: Colors.warmTint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillJoinedText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },

  emptyBlock: { paddingHorizontal: 28, paddingTop: 24, alignItems: 'center' },
  emptyTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});
