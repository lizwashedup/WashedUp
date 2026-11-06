import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../../ScaledText';
import { useFeedWishlist } from '../../../hooks/useFeedWishlist';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { PageAction } from '../../creator/pages/PageFrame';
import { hapticLight } from '../../../lib/haptics';
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
import { getPlanLifecycle } from '../../../lib/planLifecycle';
import { usePlanClock } from '../../../hooks/usePlanClock';
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
import { MemberDraftRow } from './MemberDraftRow';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useInterestedPlanActions } from '../../../hooks/useInterestedPlanActions';
import { canMakeSimilarPlan } from '../../../lib/interestedPlanActions';

/**
 * The personal "My Plans" surface: the Upcoming / Saved / Interested /
 * Waitlisted / Past sections that used to live as a tab on the public feed.
 * Moved into the Yours page so the feed stays pure discovery. Cards reuse the
 * same PlanCard + report/block/mini-profile/share affordances as the feed,
 * scoped to this surface's own data.
 */
export default function MyPlansView({ userId }: { userId: string }) {
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const cardAppearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  const router = useRouter();
  const { blockUser } = useBlock();

  const [waitlistExpanded, setWaitlistExpanded] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [interestedExpanded, setInterestedExpanded] = useState(true);
  const interestedActions = useInterestedPlanActions(userId);
  const [reportTarget, setReportTarget] = useState<{ userId: string; userName: string; eventId: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ planId: string; planTitle: string } | null>(null);
  const [shareSheet, setShareSheet] = useState<{ planId: string; planTitle: string; slug: string | null } | null>(null);

  const plansQuery = useMyPlans(userId);
  const draftsQuery = useMyPlanDrafts(userId);
  const { data: myPlans = [] } = plansQuery;
  const { data: planDrafts = [] } = draftsQuery;

  const mounted = useRef(true);
  const ownerRef = useRef({ userId });
  if (ownerRef.current.userId !== userId) ownerRef.current = { userId };
  const owner = ownerRef.current;
  const isCurrent = () => mounted.current && ownerRef.current === owner;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const openDraft = useCallback((draft: PlanDraft) => {
    if (!isCurrent()) return;
    hapticLight();
    router.push({
      pathname: '/(tabs)/post',
      params: {
        ...buildDuplicatePostParams(draft, null), draftId: draft.id, draftOwnerId: userId, draftOpenRequest: randomUUID(),
        prefillCreatorMessage: draft.host_message ?? '', similarPlanRequest: '',
        prefillInvitePersonId: '', prefillInvitePersonName: '', prefillInvitePersonPhoto: '',
      },
    } as never);
  }, [router, owner, userId]);

  const draftsHeader = COMMUNITIES_ENABLED && planDrafts.length > 0 ? (
    <View>
      <Text style={styles.sectionHeader}>Drafts</Text>
      {planDrafts.map(d => <MemberDraftRow key={userId + ':' + d.id} draft={d} userId={userId} onOpen={openDraft}/>)}
    </View>
  ) : null;
  const waitlistedQuery = useWaitlistedPlans(userId);
  const interestedQuery = useInterestedPlans(userId);
  const savedQuery = useSavedPlans(userId);
  const { data: waitlistedPlans = [] } = waitlistedQuery;
  const { data: interestedPlans = [] } = interestedQuery;
  const { data: savedBase = [] } = savedQuery;

  // Wishlist cache drives the bookmark fill state + the optimistic un-save.
  const wishlistQuery = useFeedWishlist(userId, (planId, planTitle) => setSnackbar({ planId, planTitle }), { retryReads: false });
  useFocusEffect(useCallback(() => {
    setSnackbar(null);
    setShareSheet(null);
  }, [userId]));
  const { data: wishlistIds = [] } = wishlistQuery;
  const retryLock = useRef<{ owner: object; attempt: object } | null>(null);
  const [recovery, setRecovery] = useState<{ owner: object; pending: boolean; failed: boolean } | null>(null);
  const collections = [plansQuery, savedQuery, interestedQuery, waitlistedQuery, wishlistQuery,
    ...(COMMUNITIES_ENABLED ? [draftsQuery] : [])];
  const collectionsLoading = collections.some(query => query.isLoading || query.isPending);
  const retryPending = recovery?.owner === owner && recovery.pending;
  const collectionsFailed = collections.some(query => query.isError) || (recovery?.owner === owner && recovery.failed);
  const retryCollections = () => {
    if (!isCurrent() || retryLock.current?.owner === owner) return;
    const attempt = {};
    retryLock.current = { owner, attempt };
    setRecovery({ owner, pending: true, failed: false });
    // Retry failed/incomplete reads only; successful collections stay mounted.
    const targets = collections.filter(query => query.isError || query.isLoading || query.isPending || query.data === undefined);
    const reads = targets.length ? targets : collections;
    void requestWithDeadline(Promise.all(reads.map(query => query.refetch({ cancelRefetch: false }))), 12_000)
      .then(results => {
        if (isCurrent() && retryLock.current?.attempt === attempt) {
          setRecovery({ owner, pending: false, failed: results.some(result => !!result.error) });
        }
      }).catch(() => {
        if (isCurrent() && retryLock.current?.attempt === attempt) setRecovery({ owner, pending: false, failed: true });
      }).finally(() => { if (retryLock.current?.attempt === attempt) retryLock.current = null; });
  };

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

  const planNow = usePlanClock(myPlans);
  const myPlansUpcoming = useMemo(
    () => myPlans
      .filter((p) => ['forming', 'active', 'full'].includes(p.status) && !getPlanLifecycle({ status: p.status, startTime: p.start_time, endTime: p.end_time }, planNow).isClosed)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [myPlans, planNow],
  );

  const myPlansPast = useMemo(
    () => myPlans
      .filter((p) => getPlanLifecycle({ status: p.status, startTime: p.start_time, endTime: p.end_time }, planNow).isClosed)
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 20),
    [myPlans, planNow],
  );

  // Filter the fetched saved events by the live wishlist cache so an optimistic
  // un-save removes the card instantly (mirrors the feed's allPlans.filter).
  const savedPlans = useMemo(
    () => wishlistQuery.data === undefined ? savedBase : savedBase.filter((p) => wishlistedSet[p.id]),
    [savedBase, wishlistedSet, wishlistQuery.data],
  );

  const sections = useMemo(() => {
    const s: { title: string; data: Plan[] }[] = [];
    if (myPlansUpcoming.length > 0) s.push({ title: 'Upcoming', data: myPlansUpcoming });
    if (savedPlans.length > 0) s.push({ title: 'Saved', data: savedPlans });
    if (interestedPlans.length > 0) s.push({ title: 'Interested', data: interestedExpanded ? interestedPlans : [] });
    if (waitlistedPlans.length > 0) s.push({ title: 'Waitlisted', data: waitlistExpanded ? waitlistedPlans : [] });
    if (myPlansPast.length > 0) s.push({ title: 'Past', data: pastExpanded ? myPlansPast : [] });
    return s;
  }, [myPlansUpcoming, savedPlans, interestedPlans, interestedExpanded, waitlistedPlans, waitlistExpanded, myPlansPast, pastExpanded]);

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
    ({ item, section }: { item: Plan; section: { title: string } }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          appearance={cardAppearance}
          plan={toPlanCardPlan(item)}
          isMember={!!memberIdSet[item.id]}
          isWishlisted={!!wishlistedSet[item.id]}
          wishlistPending={wishlistQuery.pending(item.id)}
          wishlistDisabled={!wishlistQuery.canWrite}
          onWishlist={(id, current) => {
            setSnackbar(null);
            wishlistQuery.toggle(id, item.title, true, !current);
          }}
          onReport={handleReport}
          onBlock={handleBlock}
          onCreatorPress={(creatorId) => setMiniProfileUserId(creatorId)}
        />
        {wishlistQuery.feedback?.kind === 'error' && wishlistQuery.feedback.call.eventId === item.id && <View style={styles.interestedRecovery}>
          <Text accessibilityRole="alert" style={styles.recoveryText}>{wishlistQuery.feedback.uncertain ? 'Couldn’t confirm this bookmark change.' : wishlistQuery.feedback.call.wantSaved
            ? 'Couldn’t save this plan.' : 'Couldn’t remove this plan from Saved.'}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Retry bookmark: ' + item.title}
            style={styles.interestedAction} onPress={wishlistQuery.retry}>
            <Text style={styles.interestedActionText}>Try again</Text>
          </TouchableOpacity>
        </View>}
        {section.title === 'Interested' && <View style={styles.interestedActions}>
          {canMakeSimilarPlan(item) && <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Make a similar plan to ${item.title}`}
            accessibilityState={{ disabled: !!interestedActions.feedback[item.id]?.pending }}
            disabled={!!interestedActions.feedback[item.id]?.pending}
            style={styles.interestedAction}
            onPress={() => void interestedActions.run(item, 'similar')}
          >
            <Text style={styles.interestedActionText}>{interestedActions.feedback[item.id]?.pending === 'similar' ? 'Opening…' : 'Make a similar plan'}</Text>
          </TouchableOpacity>}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.title} from Interested`}
            accessibilityState={{ disabled: !!interestedActions.feedback[item.id]?.pending }}
            disabled={!!interestedActions.feedback[item.id]?.pending}
            style={styles.interestedAction}
            onPress={() => void interestedActions.run(item, 'remove')}
          >
            <Text style={styles.interestedActionText}>{interestedActions.feedback[item.id]?.pending === 'remove' ? 'Removing…' : 'Remove from Interested'}</Text>
          </TouchableOpacity>
          {!!interestedActions.feedback[item.id]?.error && <View style={styles.interestedRecovery}>
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.recoveryText}>{interestedActions.feedback[item.id].error}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry for ${item.title}`} style={styles.interestedAction}
              disabled={!!interestedActions.feedback[item.id]?.pending}
              onPress={() => void interestedActions.run(item, interestedActions.feedback[item.id].retry)}>
              <Text style={styles.interestedActionText}>Try again</Text>
            </TouchableOpacity>
          </View>}
        </View>}
      </View>
    ),
    [cardAppearance, memberIdSet, wishlistedSet, wishlistQuery, handleReport, handleBlock, myPlans, savedBase, interestedPlans, waitlistedPlans, interestedActions],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (section.title === 'Interested') {
        return <TouchableOpacity style={styles.pastSectionHeader} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel={`Interested, ${interestedPlans.length} ${interestedPlans.length === 1 ? 'plan' : 'plans'}`}
          accessibilityState={{ expanded: interestedExpanded }}
          onPress={() => { hapticLight(); setInterestedExpanded(value => !value); }}>
          <Text style={[styles.sectionHeader, styles.interestedHeading]}>Interested</Text>
          <View style={styles.pastChevronRow}>
            <Text style={styles.pastCount}>{interestedPlans.length}</Text>
            {interestedExpanded ? <ChevronDown size={16} color={Colors.tertiary} /> : <ChevronRight size={16} color={Colors.tertiary} />}
          </View>
        </TouchableOpacity>;
      }
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
    [pastExpanded, myPlansPast.length, waitlistExpanded, waitlistedPlans.length, interestedExpanded, interestedPlans.length],
  );

  const hasContent = sections.length > 0 || !!draftsHeader;
  const recoveryNotice = collectionsFailed ? <View style={hasContent ? styles.recoveryRow : styles.errorState}>
    <Text style={[styles.recoveryText, hasContent && styles.recoveryCopy]}>
      {hasContent ? 'Some plans couldn’t refresh. Your saved details are still here.' : 'Your plans couldn’t load. Try again to see them.'}
    </Text>
    <PageAction primary={!hasContent} compact singleLine title={retryPending ? 'Retrying…' : 'Try again'} disabled={retryPending} onPress={retryCollections} />
  </View> : null;
  return (
    <View style={styles.fill}>
      {!hasContent && collectionsFailed ? recoveryNotice : !hasContent && (collectionsLoading || retryPending) ? (
        <SkeletonFeed />
      ) : !hasContent ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>You haven't joined any plans yet.</Text>
          <PageAction primary compact singleLine title="Browse Plans" onPress={() => { if (isCurrent()) router.push('/(tabs)/plans'); }} />
        </View>
      ) : (
        <SectionList
          ListHeaderComponent={<>{recoveryNotice}{!!wishlistQuery.identityError && <View style={styles.recoveryRow}>
            <Text style={[styles.recoveryText, styles.recoveryCopy]}>Couldn’t check your account to save plans.</Text>
            <PageAction compact title="Try again" onPress={() => void wishlistQuery.retryIdentity()}/>
          </View>}{collectionsLoading && !collectionsFailed && <Text style={styles.loadingText}>Loading the rest of your plans…</Text>}{draftsHeader}</>}
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

    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 32 },
  cardWrap: { marginBottom: 14 },
  interestedActions: { paddingHorizontal: 8, paddingTop: 4, flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  interestedAction: { minHeight: 44, justifyContent: 'center', paddingVertical: 10, maxWidth: '100%' },
  interestedActionText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  interestedRecovery: { width: '100%', paddingTop: 4 },
  interestedHeading: { marginTop: 0, marginBottom: 0, flexShrink: 1 },
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
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  recoveryCopy: { flex: 1, minWidth: 0 },
  recoveryText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  loadingText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, paddingVertical: 12 },
});
