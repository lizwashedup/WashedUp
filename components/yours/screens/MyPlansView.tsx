import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, X } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import { withTimeout } from '../../../lib/withTimeout';
import { hapticLight, hapticError } from '../../../lib/haptics';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { PlanCard } from '../../plans/PlanCard';
import { SkeletonFeed } from '../../SkeletonCard';
import MiniProfileCard from '../../MiniProfileCard';
import { ReportModal } from '../../modals/ReportModal';
import { SaveSnackbar } from '../../SaveSnackbar';
import { ShareSheet } from '../../ShareSheet';
import { useBlock } from '../../../hooks/useBlock';
import { toPlanCardPlan } from '../../../lib/creatorMarks';
import type { Plan } from '../../../lib/fetchPlans';
import {
  useMyPlans,
  useMyPlanDrafts,
  useWaitlistedPlans,
  useInterestedPlans,
  useSavedPlans,
  type PlanDraft,
} from '../../../hooks/useMyPlansData';
import { COMMUNITIES_ENABLED } from '../../../constants/FeatureFlags';
import { buildDuplicatePostParams } from '../../../lib/duplicatePlan';
import { BrandedAlert, type BrandedAlertButton } from '../../BrandedAlert';

const WISHLISTS_TIMEOUT_MS = 8000;

/**
 * The personal "My Plans" surface: the Upcoming / Saved / Interested /
 * Waitlisted / Past sections that used to live as a tab on the public feed.
 * Moved into the Yours page so the feed stays pure discovery. Cards reuse the
 * same PlanCard + report/block/mini-profile/share affordances as the feed,
 * scoped to this surface's own data.
 */
export default function MyPlansView({ userId }: { userId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { blockUser } = useBlock();

  const [waitlistExpanded, setWaitlistExpanded] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ userId: string; userName: string; eventId: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ planId: string; planTitle: string } | null>(null);
  const [shareSheet, setShareSheet] = useState<{ planId: string; planTitle: string; slug: string | null } | null>(null);

  const { data: myPlans = [], isLoading: myPlansLoading } = useMyPlans(userId);
  const { data: planDrafts = [] } = useMyPlanDrafts(userId);
  const [draftAlert, setDraftAlert] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const openDraft = useCallback((draft: PlanDraft) => {
    hapticLight();
    router.push({
      pathname: '/(tabs)/post',
      params: { ...buildDuplicatePostParams(draft, null), draftId: draft.id },
    } as never);
  }, [router]);

  const confirmDeleteDraft = useCallback((draft: PlanDraft) => {
    // LIZ COPY
    setDraftAlert({
      title: 'toss this draft?',
      message: 'it goes for good.',
      buttons: [
        { text: 'keep it', style: 'cancel' },
        {
          text: 'toss it',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('events').delete().eq('id', draft.id).eq('status', 'draft');
            queryClient.invalidateQueries({ queryKey: ['my-plan-drafts'] });
          },
        },
      ],
    });
  }, [queryClient]);

  const draftsHeader = COMMUNITIES_ENABLED && planDrafts.length > 0 ? (
    <View>
      <Text style={styles.sectionHeader}>Drafts</Text>
      {planDrafts.map((d) => (
        <TouchableOpacity key={d.id} style={styles.draftRow} onPress={() => openDraft(d)} activeOpacity={0.7}>
          <View style={styles.draftBody}>
            <Text style={styles.draftTitle} numberOfLines={1}>{d.title}</Text>
            <Text style={styles.draftMeta} numberOfLines={1}>
              {new Date(d.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {'  ·  finish it whenever'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => confirmDeleteDraft(d)} hitSlop={10}>
            <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;
  const { data: waitlistedPlans = [] } = useWaitlistedPlans(userId);
  const { data: interestedPlans = [] } = useInterestedPlans(userId);
  const { data: savedBase = [] } = useSavedPlans(userId);

  // Wishlist cache drives the bookmark fill state + the optimistic un-save.
  const { data: wishlistIds = [] } = useQuery<string[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await withTimeout(
        supabase.from('wishlists').select('event_id').eq('user_id', userId),
        WISHLISTS_TIMEOUT_MS,
        { data: [] } as any,
      );
      return (data ?? []).map((r: any) => r.event_id as string);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const wishlistMutation = useMutation({
    mutationFn: async ({ eventId, current }: { eventId: string; current: boolean }) => {
      if (!userId) return;
      if (current) {
        await supabase.from('wishlists').delete().eq('user_id', userId).eq('event_id', eventId);
      } else {
        await supabase.from('wishlists').insert({ user_id: userId, event_id: eventId });
      }
    },
    onMutate: async ({ eventId, current }: { eventId: string; current: boolean }) => {
      if (!userId) return { prev: undefined as string[] | undefined };
      const key = ['wishlists', userId];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (old = []) =>
        current ? old.filter((id) => id !== eventId) : [...old, eventId],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      hapticError();
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(['wishlists', userId], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });
      queryClient.invalidateQueries({ queryKey: ['saved-plans'] });
    },
  });

  const wishlistedSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    wishlistIds.forEach((id: string) => { lookup[id] = true; });
    return lookup;
  }, [wishlistIds]);

  // Every plan in My Plans is one you joined or created.
  const memberIdSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    myPlans.forEach((p: Plan) => { lookup[p.id] = true; });
    return lookup;
  }, [myPlans]);

  const myPlansUpcoming = useMemo(
    () => myPlans
      .filter((p) => ['forming', 'active', 'full'].includes(p.status) && new Date(p.start_time) >= new Date(Date.now() - 3 * 60 * 60 * 1000))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [myPlans],
  );

  const myPlansPast = useMemo(
    () => myPlans
      .filter((p) => p.status === 'completed' || new Date(p.start_time) < new Date(Date.now() - 3 * 60 * 60 * 1000))
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 20),
    [myPlans],
  );

  // Filter the fetched saved events by the live wishlist cache so an optimistic
  // un-save removes the card instantly (mirrors the feed's allPlans.filter).
  const savedPlans = useMemo(
    () => savedBase.filter((p) => wishlistedSet[p.id]),
    [savedBase, wishlistedSet],
  );

  const sections = useMemo(() => {
    const s: { title: string; data: Plan[] }[] = [];
    if (myPlansUpcoming.length > 0) s.push({ title: 'Upcoming', data: myPlansUpcoming });
    if (savedPlans.length > 0) s.push({ title: 'Saved', data: savedPlans });
    if (interestedPlans.length > 0) s.push({ title: 'Interested', data: interestedPlans });
    if (waitlistedPlans.length > 0) s.push({ title: 'Waitlisted', data: waitlistExpanded ? waitlistedPlans : [] });
    if (myPlansPast.length > 0) s.push({ title: 'Past', data: pastExpanded ? myPlansPast : [] });
    return s;
  }, [myPlansUpcoming, savedPlans, interestedPlans, waitlistedPlans, waitlistExpanded, myPlansPast, pastExpanded]);

  const handleReport = useCallback((planId: string) => {
    const plan = [...myPlans, ...waitlistedPlans, ...savedBase, ...interestedPlans].find((p) => p.id === planId);
    if (plan?.creator?.id) {
      setReportTarget({
        userId: plan.creator.id,
        userName: plan.creator.first_name_display ?? 'User',
        eventId: planId,
      });
    }
  }, [myPlans, waitlistedPlans, savedBase, interestedPlans]);

  const handleBlock = useCallback((planId: string) => {
    const plan = [...myPlans, ...waitlistedPlans, ...savedBase, ...interestedPlans].find((p) => p.id === planId);
    if (plan?.creator?.id) {
      blockUser(plan.creator.id, plan.creator.first_name_display ?? 'User');
    }
  }, [myPlans, waitlistedPlans, savedBase, interestedPlans, blockUser]);

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          plan={toPlanCardPlan(item)}
          isMember={!!memberIdSet[item.id]}
          isWishlisted={!!wishlistedSet[item.id]}
          onWishlist={(id, current) => {
            wishlistMutation.mutate({ eventId: id, current });
            if (!current) {
              const plan = [...myPlans, ...savedBase, ...interestedPlans, ...waitlistedPlans].find((p) => p.id === id);
              setSnackbar({ planId: id, planTitle: plan?.title ?? '' });
            } else {
              setSnackbar(null);
            }
          }}
          onReport={handleReport}
          onBlock={handleBlock}
          onCreatorPress={(creatorId) => setMiniProfileUserId(creatorId)}
          isPast={item.status === 'completed'}
        />
      </View>
    ),
    [memberIdSet, wishlistedSet, wishlistMutation, handleReport, handleBlock, myPlans, savedBase, interestedPlans, waitlistedPlans],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (section.title === 'Past') {
        return (
          <TouchableOpacity
            style={styles.pastSectionHeader}
            onPress={() => { hapticLight(); setPastExpanded((v) => !v); }}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.pastChevronRow}>
              <Text style={styles.pastCount}>{myPlansPast.length}</Text>
              {pastExpanded
                ? <ChevronDown size={16} color={Colors.tertiary} />
                : <ChevronRight size={16} color={Colors.tertiary} />}
            </View>
          </TouchableOpacity>
        );
      }
      if (section.title === 'Waitlisted') {
        return (
          <TouchableOpacity
            style={styles.pastSectionHeader}
            onPress={() => { hapticLight(); setWaitlistExpanded((v) => !v); }}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.pastChevronRow}>
              <Text style={styles.pastCount}>{waitlistedPlans.length}</Text>
              {waitlistExpanded
                ? <ChevronDown size={16} color={Colors.tertiary} />
                : <ChevronRight size={16} color={Colors.tertiary} />}
            </View>
          </TouchableOpacity>
        );
      }
      return <Text style={styles.sectionHeader}>{section.title}</Text>;
    },
    [pastExpanded, myPlansPast.length, waitlistExpanded, waitlistedPlans.length],
  );

  return (
    <View style={styles.fill}>
      {myPlansLoading ? (
        <SkeletonFeed />
      ) : sections.length === 0 && !draftsHeader ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>You haven't joined any plans yet.</Text>
          <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/(tabs)/plans')}>
            <Text style={styles.emptyButtonText}>Browse Plans</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          ListHeaderComponent={draftsHeader}
          decelerationRate="normal"
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          windowSize={11}
        />
      )}

      {reportTarget && (
        <ReportModal
          visible
          onClose={() => setReportTarget(null)}
          reportedUserId={reportTarget.userId}
          reportedUserName={reportTarget.userName}
          eventId={reportTarget.eventId}
        />
      )}

      <MiniProfileCard
        visible={!!miniProfileUserId}
        userId={miniProfileUserId}
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setMiniProfileUserId(null);
          setReportTarget({ userId: uid, userName: uname, eventId: '' });
        }}
        onBlock={(uid, uname) => {
          setMiniProfileUserId(null);
          blockUser(uid, uname);
        }}
      />

      <SaveSnackbar
        visible={!!snackbar}
        planId={snackbar?.planId ?? ''}
        planTitle={snackbar?.planTitle ?? ''}
        onShare={(id) => {
          setSnackbar(null);
          const plan = [...myPlans, ...savedBase, ...interestedPlans, ...waitlistedPlans].find((p) => p.id === id);
          setShareSheet({ planId: id, planTitle: plan?.title ?? '', slug: plan?.slug ?? null });
        }}
        onDismiss={() => setSnackbar(null)}
      />

      <ShareSheet
        visible={!!shareSheet}
        planId={shareSheet?.planId ?? ''}
        planTitle={shareSheet?.planTitle ?? ''}
        slug={shareSheet?.slug ?? undefined}
        onClose={() => setShareSheet(null)}
      />

      <BrandedAlert
        visible={!!draftAlert}
        title={draftAlert?.title ?? ''}
        message={draftAlert?.message}
        buttons={draftAlert?.buttons}
        onClose={() => setDraftAlert(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  draftBody: { flex: 1 },
  draftTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  draftMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  listContent: { paddingHorizontal: 20, paddingBottom: 32 },
  cardWrap: { marginBottom: 14 },
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 24,
    marginBottom: 12,
  },
  pastSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  pastChevronRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pastCount: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.secondary, textAlign: 'center', marginBottom: 20 },
  emptyButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  emptyButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
