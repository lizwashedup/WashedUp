import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import { ArrowLeft, Share2, Heart, Calendar, MapPin, Ticket, Users, ChevronRight, MoreHorizontal } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { openUrl } from '../../lib/url';
import LinkifiedText from '../../components/LinkifiedText';
import { ReportModal } from '../../components/modals/ReportModal';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { useBlock } from '../../hooks/useBlock';
import Colors from '../../constants/Colors';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../constants/Typography';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { getMyRsvp, getRsvpCount, markNudged, setRsvp, wasNudged } from '../../lib/eventRsvp';
import { formatEventDateLA } from '../../lib/laDate';
import { formatTicketPrice, normalizeTicketPrice } from '../../lib/ticketPrice';
import { getOrganizerProfiles } from '../../lib/organizerProfile';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ExploreEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  // Postgres numeric: arrives as a number or a numeric string depending on
  // the path; normalizeTicketPrice is the one reading (doc 34 2.3)
  ticket_price: number | string | null;
  public_name: string | null;
  community_id: string | null;
  host_user_id: string | null;
}

interface LinkedPlan {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  member_count: number;
  max_invites: number;
  status: string;
  creator_user_id: string;
  creator_name: string | null;
  creator_photo: string | null;
  primary_vibe: string | null;
}

function formatFullDate(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return '';
  const dayLabel = formatEventDateLA(dateStr, { weekday: 'long', month: 'long', day: 'numeric' });
  if (timeStr) {
    let t: string;
    // Handle full ISO timestamps (e.g. "2025-03-22T18:00:00+00:00") and
    // time-only strings (e.g. "18:00:00") gracefully.
    const ts = new Date(timeStr);
    if (!isNaN(ts.getTime())) {
      t = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else {
      // Fallback: parse a plain "HH:MM" or "HH:MM:SS" time string
      const parts = timeStr.split(':');
      const h = parts[0] ?? '0';
      const m = parts[1] ?? '0';
      const tmp = new Date();
      tmp.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
      t = tmp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return `${dayLabel} at ${t}`;
  }
  return dayLabel;
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const { blockUser } = useBlock();

  React.useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => {});
  }, []);

  const handleCreatorMenu = useCallback((creatorId: string, creatorName: string) => {
    if (creatorId === userId) return;
    hapticLight();
    setAlertInfo({
      title: creatorName,
      buttons: [
        {
          text: `Report ${creatorName}`,
          onPress: () => {
            setReportTarget({ id: creatorId, name: creatorName });
            setShowReport(true);
          },
        },
        {
          text: `Block ${creatorName}`,
          style: 'destructive',
          onPress: () => blockUser(creatorId, creatorName, () => {
            queryClient.invalidateQueries({ queryKey: ['event-plans', id] });
          }),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    });
  }, [userId, blockUser, queryClient, id]);

  const { data: event, isLoading } = useQuery({
    queryKey: ['explore-event', id],
    queryFn: async (): Promise<ExploreEvent | null> => {
      const { data, error } = await supabase
        .from('explore_events')
        .select('id, title, description, image_url, event_date, start_time, venue, venue_address, category, external_url, ticket_price, public_name, community_id, host_user_id')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: linkedPlans = [] } = useQuery({
    queryKey: ['event-plans', id],
    queryFn: async (): Promise<LinkedPlan[]> => {
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, title, start_time, location_text, member_count, max_invites, status,
          creator_user_id, primary_vibe,
          profiles!events_creator_user_id_fkey ( first_name_display, profile_photo_url )
        `)
        .eq('explore_event_id', id)
        .in('status', ['forming', 'active', 'full'])
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        creator_name: p.profiles?.first_name_display ?? null,
        creator_photo: p.profiles?.profile_photo_url ?? null,
      }));
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // Fetch actual member counts from event_members — member_count on events can be out of sync
  const planIdsKey = linkedPlans.map((p) => p.id).sort().join(',');
  const { data: memberCountsMap = {} } = useQuery({
    queryKey: ['event-plans-member-counts', planIdsKey],
    queryFn: async (): Promise<Record<string, number>> => {
      const planIds = linkedPlans.map((p) => p.id);
      if (planIds.length === 0) return {};
      const { data, error } = await supabase
        .from('event_members')
        .select('event_id')
        .in('event_id', planIds)
        .eq('status', 'joined');
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: { event_id: string }) => {
        counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      });
      return counts;
    },
    enabled: linkedPlans.length > 0,
  });

  const { data: isWishlisted = false } = useQuery({
    queryKey: ['explore-wishlist-check', id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('explore_wishlists')
        .select('id')
        .eq('user_id', userId!)
        .eq('explore_event_id', id!)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    enabled: !!userId && !!id,
  });

  const wishlistMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !id) return;
      if (isWishlisted) {
        await supabase.from('explore_wishlists').delete().eq('user_id', userId).eq('explore_event_id', id);
      } else {
        await supabase.from('explore_wishlists').insert({ user_id: userId, explore_event_id: id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
      queryClient.invalidateQueries({ queryKey: ['explore-wishlist-check', id] });
    },
    onError: () => {
      hapticError();
    },
  });

  // -- just-join RSVPs + the doc 09 smart popup (flag-gated additions) ----------
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const { data: myRsvp = null } = useQuery({
    queryKey: ['event-rsvp', id, userId],
    queryFn: () => getMyRsvp(id!),
    enabled: COMMUNITIES_ENABLED && !!id && !!userId,
  });
  const { data: rsvpCount = null } = useQuery({
    queryKey: ['event-rsvp-count', id],
    queryFn: () => getRsvpCount(id!),
    enabled: COMMUNITIES_ENABLED && !!id,
  });

  // proposal 36: a STANDALONE listing with no per-event public_name override
  // fronts with the host's organizer profile (name + logo). Community events
  // keep fronting with the community; public_name always wins when set.
  const { data: organizer = null } = useQuery({
    queryKey: ['organizer-profile-of', event?.host_user_id],
    queryFn: async () => {
      const map = await getOrganizerProfiles([event!.host_user_id!]);
      return map.get(event!.host_user_id!) ?? null;
    },
    enabled:
      COMMUNITIES_ENABLED && !!event && !event.community_id && !!event.host_user_id && !event.public_name,
    staleTime: 60_000,
  });

  const goFindPeople = useCallback(() => {
    if (!event) return;
    hapticMedium();
    router.push({
      pathname: '/(tabs)/post',
      params: {
        prefillTitle: event.title,
        prefillExploreEventId: event.id,
        prefillStartTime: event.start_time ?? '',
        prefillEventDate: event.event_date ?? '',
        prefillDescription: event.description ?? '',
        prefillImageUrl: event.image_url ?? '',
        prefillLocation: event.venue_address ?? event.venue ?? '',
        prefillCategory: event.category ?? '',
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const invalidateRsvp = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['event-rsvp', id] });
    queryClient.invalidateQueries({ queryKey: ['event-rsvp-count', id] });
    // going in or out of a community event adds or removes its chat
    queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
  }, [queryClient, id]);

  const handleCountMeIn = useCallback(async () => {
    if (!id || rsvpBusy) return;
    if (myRsvp === 'going') {
      // LIZ COPY
      setAlertInfo({
        title: 'not going anymore?',
        message: 'no pressure either way.',
        buttons: [
          { text: 'still going', style: 'cancel' },
          {
            text: 'take me off',
            onPress: async () => {
              try {
                await setRsvp(id, false);
                invalidateRsvp();
              } catch {
                hapticError();
              }
            },
          },
        ],
      });
      return;
    }
    setRsvpBusy(true);
    try {
      await setRsvp(id, true);
      hapticSuccess();
      invalidateRsvp();
      // the smart popup: one nudge per event, never again once answered
      if (!(await wasNudged(id))) {
        await markNudged(id);
        const openPlans = linkedPlans.filter((p) => {
          const actualCount = memberCountsMap[p.id] ?? p.member_count;
          return capDisplayCount(actualCount) < Math.min((p.max_invites ?? 7) + 1, MAX_GROUP);
        });
        if (openPlans.length > 0) {
          // LIZ COPY
          setAlertInfo({
            title: 'a group is forming for this',
            message: 'want in? your spot at the event stands either way.',
            buttons: [
              { text: 'see the group', onPress: () => router.push(`/plan/${openPlans[0].id}`) },
              { text: 'find people to go with', onPress: goFindPeople },
              { text: 'just going', style: 'cancel' },
            ],
          });
        } else {
          // LIZ COPY
          setAlertInfo({
            title: 'want people to go with?',
            message: "you're in either way. small groups form around events like this.",
            buttons: [
              { text: 'find people', onPress: goFindPeople },
              { text: 'just going', style: 'cancel' },
            ],
          });
        }
      }
    } catch {
      hapticError();
    } finally {
      setRsvpBusy(false);
    }
  }, [id, rsvpBusy, myRsvp, linkedPlans, memberCountsMap, invalidateRsvp, goFindPeople]);

  if (!id || isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          {!id ? (
            <>
              <Text style={styles.emptyText}>Event not found</Text>
              <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
                <Text style={styles.goBackText}>Go Back</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator size="large" color={Colors.terracotta} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Event not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const ticketPrice = normalizeTicketPrice(event.ticket_price);
  const isFree = ticketPrice === null;

  // the byline: per-event public_name override wins; a standalone listing
  // falls back to the organizer profile, whose logo only shows when the
  // name is actually the profile's (an override means a different brand)
  const bylineName = event.public_name || (!event.community_id ? organizer?.display_name ?? null : null);
  const bylineLogo = !event.public_name && !event.community_id ? organizer?.logo_url ?? null : null;

  const getPlanSpotsInfo = (plan: LinkedPlan): { text: string; isFull: boolean } => {
    const actualCount = memberCountsMap[plan.id] ?? plan.member_count;
    const capped = capDisplayCount(actualCount);
    const totalCapacity = Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
    const left = Math.max(0, totalCapacity - capped);
    const isFull = left === 0;
    const text = isFull ? 'Full' : `${left} ${left === 1 ? 'spot' : 'spots'} left`;
    return { text, isFull };
  };

  return (
    <View style={styles.container}>
      <ScrollView decelerationRate="normal" showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          <Image
            source={event.image_url ? { uri: event.image_url } : require('../../assets/images/plan-placeholder.png')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, left: 16 }]}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, right: 60 }]}
            onPress={async () => {
              hapticLight();
              try {
                await Share.share({
                  message: `${event.title}\nhttps://washedup.app/e/${event.id}`,
                });
              } catch {}
            }}
          >
            <Share2 size={18} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.circleButton, { top: insets.top + 8, right: 16 }]}
            onPress={() => {
              hapticLight();
              wishlistMutation.mutate();
            }}
          >
            <Heart
              size={18}
              color={isWishlisted ? Colors.terracotta : Colors.asphalt}
              fill={isWishlisted ? Colors.terracotta : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {event.category && (
            <View style={[styles.detailCategoryPill, { backgroundColor: Colors.terracotta }]}>
              <Text style={styles.detailCategoryText}>{event.category.toLowerCase()}</Text>
            </View>
          )}

          <Text style={styles.title}>{event.title}</Text>

          {COMMUNITIES_ENABLED && !!bylineName && (
            <View style={styles.putOnByRow}>
              {!!bylineLogo && (
                <Image source={{ uri: bylineLogo }} style={styles.putOnByLogo} contentFit="cover" />
              )}
              {/* LIZ COPY (decision 16): bylines say put on by, never hosted by */}
              <Text style={styles.putOnBy}>put on by {bylineName}</Text>
            </View>
          )}

          <View style={styles.metaRow}>
            <Calendar size={16} color={Colors.warmGray} strokeWidth={2} />
            <Text style={styles.metaText}>{formatFullDate(event.event_date, event.start_time)}</Text>
          </View>

          {event.venue && (
            <View style={styles.metaRow}>
              <MapPin size={16} color={Colors.warmGray} strokeWidth={2} />
              <Text style={styles.metaText}>
                {event.venue}{event.venue_address ? ` · ${event.venue_address}` : ''}
              </Text>
            </View>
          )}

          {ticketPrice !== null && (
            <View style={styles.metaRow}>
              <Ticket size={16} color={Colors.warmGray} strokeWidth={2} />
              <Text style={styles.metaText}>{formatTicketPrice(ticketPrice)}</Text>
            </View>
          )}

          {COMMUNITIES_ENABLED && rsvpCount !== null && rsvpCount > 0 && (
            <View style={styles.metaRow}>
              <Users size={16} color={Colors.warmGray} strokeWidth={2} />
              <Text style={styles.metaText}>{rsvpCount} going</Text>
            </View>
          )}

          {event.description && (
            <View style={styles.descriptionSection}>
              <LinkifiedText text={event.description} style={styles.descriptionText} />
            </View>
          )}

          {/* the link-out shows whenever a link exists (doc 34 2.1): a free
              event with a reservation link used to show nothing at all */}
          {event.external_url && (
            <TouchableOpacity
              style={styles.ticketLink}
              onPress={() => openUrl(event.external_url!)}
            >
              {/* LIZ COPY: priced vs free-with-link labels */}
              <Text style={styles.ticketLinkText}>{isFree ? 'reserve a spot' : 'get tickets'}</Text>
              <ChevronRight size={16} color={Colors.terracotta} strokeWidth={2} />
            </TouchableOpacity>
          )}

          <View style={styles.plansSection}>
            <View style={styles.plansSectionHeader}>
              <Users size={18} color={Colors.asphalt} strokeWidth={2} />
              <Text style={styles.plansSectionTitle}>People Going With washedup</Text>
            </View>

            {linkedPlans.length === 0 ? (
              <Text style={styles.noPlansText}>no one has posted a plan yet. go first.</Text>
            ) : (
              linkedPlans.map(plan => {
                const { text: spotsText, isFull } = getPlanSpotsInfo(plan);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.planCard}
                    onPress={() => router.push(`/plan/${plan.id}`)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.planCardTop}>
                      {plan.creator_photo ? (
                        <Image source={{ uri: plan.creator_photo }} style={styles.planCreatorAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.planCreatorAvatar, styles.planCreatorAvatarFallback]}>
                          <Text style={styles.planCreatorInitial}>
                            {plan.creator_name?.[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.planCreatorName}>{plan.creator_name ?? 'Someone'} posted</Text>
                      {plan.primary_vibe && (
                        <View style={styles.planVibePill}>
                          <Text style={styles.planVibeText}>{plan.primary_vibe}</Text>
                        </View>
                      )}
                      <View style={styles.planCardSpacer} />
                      {plan.creator_user_id !== userId && (
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleCreatorMenu(plan.creator_user_id, plan.creator_name ?? 'this person');
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.planMenuBtn}
                        >
                          <MoreHorizontal size={16} color={Colors.textLight} />
                        </TouchableOpacity>
                      )}
                      <View style={[
                        styles.planJoinBtn,
                        isFull && styles.planJoinBtnFull,
                      ]}>
                        <Text style={[
                          styles.planJoinBtnText,
                          isFull && styles.planJoinBtnTextFull,
                        ]}>
                          {isFull ? 'Full' : 'Join'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <Text style={styles.planMeta}>{spotsText}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + 8 }]}>
        {COMMUNITIES_ENABLED && (
          <TouchableOpacity
            style={[styles.rsvpButton, myRsvp === 'going' && styles.rsvpButtonGoing]}
            onPress={handleCountMeIn}
            disabled={rsvpBusy}
          >
            {rsvpBusy ? (
              <ActivityIndicator size="small" color={Colors.terracotta} />
            ) : (
              <Text style={[styles.rsvpButtonText, myRsvp === 'going' && styles.rsvpButtonTextGoing]}>
                {myRsvp === 'going' ? "you're going" : 'count me in'}
              </Text>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.postPlanButton} onPress={goFindPeople}>
          <Text style={styles.postPlanButtonText}>Find People to Go With</Text>
        </TouchableOpacity>
      </View>

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.textMedium, textAlign: 'center' },
  goBackBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 },
  goBackText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  heroContainer: { width: SCREEN_WIDTH, height: 280, position: 'relative' },
  circleButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlayWhite90,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: { padding: 20, gap: 12 },
  detailCategoryPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  // sentence-lowercase, no transforms (C16 + the lowercase law)
  detailCategoryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    lineHeight: 34,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, flex: 1, lineHeight: 20 },
  descriptionSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: Colors.inputBg },
  descriptionText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, lineHeight: 22 },
  ticketLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8 },
  ticketLinkText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  plansSection: { marginTop: 16, paddingTop: 20, borderTopWidth: 1, borderTopColor: Colors.inputBg, gap: 12 },
  plansSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plansSectionTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  noPlansText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, fontStyle: 'italic' },
  planCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.inputBg,
  },
  planCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCreatorAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  planCreatorAvatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center' as const, justifyContent: 'center' as const },
  planCreatorInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  planCreatorName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  planVibePill: { backgroundColor: Colors.inputBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  // sentence-lowercase, no transforms (C16 + the lowercase law)
  planVibeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.warmGray },
  planCardSpacer: { flex: 1 },
  planMenuBtn: { padding: 4, marginRight: 4 },
  planJoinBtn: { backgroundColor: Colors.terracotta, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14 },
  planJoinBtnFull: { backgroundColor: Colors.border },
  planJoinBtnTextFull: { color: Colors.textLight },
  planJoinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  planTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  planMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.warmGray },
  stickyBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.parchment,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  postPlanButton: {
    flex: 1,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postPlanButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  // RSVP: outline until going; going = the documented gold confirmed-state
  // (fill + hairline gold border + brandDeep label), never a terracotta CTA
  rsvpButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpButtonGoing: {
    backgroundColor: Colors.goingConfirmedFill,
    borderColor: Colors.gold,
  },
  rsvpButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
  rsvpButtonTextGoing: { color: Colors.brandDeep },
  putOnByRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  putOnByLogo: { width: 18, height: 18, borderRadius: 5 },
  putOnBy: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
  },
});
