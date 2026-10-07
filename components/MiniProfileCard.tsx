import { Image } from 'expo-image';
import { Home, MapPin, Plane, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { getBlockedWith } from '../lib/blocking';
import { subscribeChatListPrivacy } from '../lib/chatListCache';
import MarkIcon from './marks/MarkIcons';

interface MiniProfileCardProps {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  onReport?: (userId: string, userName: string) => void;
  onBlock?: (userId: string, userName: string) => void;
}

interface MiniProfile {
  first_name_display: string | null;
  profile_photo_url: string | null;
  neighborhood: string | null;
  is_traveling: boolean;
  fun_fact: string | null;
  city: string | null;
  is_visitor: boolean;
}

interface ProfileMarks {
  highest_milestone_slug: string | null;
  highest_milestone_name: string | null;
  highest_milestone_icon: string | null;
  pinned_identity_slug: string | null;
  pinned_identity_name: string | null;
  pinned_identity_icon: string | null;
  pinned_identity_description: string | null;
}

export default function MiniProfileCard({ visible, userId, onClose, onReport, onBlock }: MiniProfileCardProps) {
  const [identityExpanded, setIdentityExpanded] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const revision = useRef(0), mounted = useRef(false);
  const verifiedViewer = useRef<string | null>(null);
  const visit = useMemo(() => ({ visible, userId, authEpoch }), [visible, userId, authEpoch]);
  const activeVisit = useRef(visit); activeVisit.current = visit;
  const pendingAction = useRef<object | null>(null);
  const [loaded, setLoaded] = useState<{ visit: typeof visit; profile: MiniProfile | null; marks: ProfileMarks | null; viewer: string | null; loading: boolean } | null>(null);
  const owned = loaded?.visit === visit ? loaded : null;
  const profile = owned?.profile ?? null, marks = owned?.marks ?? null;
  const currentUserId = owned?.viewer ?? null;
  const loading = visible && !!userId && (!owned || owned.loading);
  const isCurrent = () => mounted.current && activeVisit.current === visit && visit.visible && !!visit.userId && revision.current === visit.authEpoch;

  // Watching auth events is passive. A hidden sheet must not compete with the
  // conversation for an auth read; verification begins only when it opens.
  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (!mounted.current || event === 'INITIAL_SESSION') return;
      verifiedViewer.current = null;
      pendingAction.current = null;
      setAuthEpoch(++revision.current);
    });
    const stopPrivacy = subscribeChatListPrivacy((viewerId, blockedId) => {
      if (!mounted.current || verifiedViewer.current !== viewerId || activeVisit.current.userId !== blockedId) return;
      pendingAction.current = null;
      setAuthEpoch(++revision.current);
    });
    return () => { mounted.current = false; pendingAction.current = null; subscription.unsubscribe(); stopPrivacy(); };
  }, []);

  useEffect(() => {
    if (!visible || !userId) return;
    pendingAction.current = null;
    setIdentityExpanded(false);
    let cancelled = false;
    const current = () => !cancelled && isCurrent();
    const update = (patch: Partial<NonNullable<typeof loaded>>) => {
      if (current()) setLoaded(previous => previous?.visit === visit ? { ...previous, ...patch } : previous);
    };
    setLoaded({ visit, profile: null, marks: null, viewer: null, loading: true });
    (async () => {
      try {
        const { data: auth, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        if (!current() || authError || !auth.user) return;
        verifiedViewer.current = auth.user.id;
        update({ viewer: auth.user.id });
        const blocked = await requestWithDeadline(getBlockedWith(auth.user.id, [userId]), 12_000);
        if (!current() || blocked.has(userId)) return;
        // Keep the existing private-profile read and public fallback, but never
        // publish or continue enrichment after the viewer/target/visit changes.
        const { data, error } = await requestWithDeadline(supabase
          .from('profiles')
          .select('first_name_display, profile_photo_url, neighborhood, is_traveling, fun_fact, city, is_visitor')
          .eq('id', userId).single(), 12_000);
        if (!current()) return;
        if (data && !error) update({ profile: data as MiniProfile });
        else {
          const { data: pub } = await requestWithDeadline(supabase.from('profiles_public')
            .select('first_name_display, profile_photo_url, city, is_visitor').eq('id', userId).single(), 12_000);
          if (!current()) return;
          if (pub) update({ profile: { first_name_display: pub.first_name_display, profile_photo_url: pub.profile_photo_url,
            city: pub.city ?? null, neighborhood: null, is_traveling: false, fun_fact: null, is_visitor: (pub as any).is_visitor ?? false } });
        }
        const { data: marksData } = await requestWithDeadline(supabase.rpc('get_user_profile_marks', { p_user_id: userId }), 12_000);
        if (current() && marksData?.[0]) update({ marks: marksData[0] as ProfileMarks });
      } catch {} finally { update({ loading: false }); }
    })();
    return () => { cancelled = true; };
  }, [visit]);

  const close = () => { pendingAction.current = null; onClose(); };
  const moderate = (action?: (id: string, name: string) => void) => {
    if (!action || !isCurrent() || !currentUserId || !userId || currentUserId === userId) return;
    const attempt = {}; pendingAction.current = attempt;
    const epoch = revision.current, target = userId, targetName = profile?.first_name_display ?? 'Member';
    onClose();
    // The intentional dismissal may hide this sheet. A new opening, auth event
    // or unmount cancels its delayed sibling action, preserving modal sequencing.
    setTimeout(() => {
      if (!mounted.current || pendingAction.current !== attempt || revision.current !== epoch) return;
      pendingAction.current = null; action(target, targetName);
    }, 150);
  };

  if (!visible) return null;

  const name = profile?.first_name_display ?? 'Member';
  const locationText = profile?.neighborhood ?? profile?.city ?? null;
  const isTraveling = profile?.is_traveling ?? false;
  const isVisitor = profile?.is_visitor ?? false;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={close} accessible={false}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()} accessible={false}
          accessibilityViewIsModal onAccessibilityEscape={close}>
          <TouchableOpacity style={styles.closeButton} onPress={close}
            accessibilityRole="button" accessibilityLabel="Close profile">
            <X size={20} color={Colors.textMedium} />
          </TouchableOpacity>
          {loading ? (
            <ActivityIndicator size="large" color={Colors.terracotta} style={{ paddingVertical: 40 }} />
          ) : !profile ? (
            <Text style={styles.name}>Profile unavailable</Text>
          ) : (
            <>
              {/* Avatar */}
              {profile?.profile_photo_url ? (
                <Image
                  source={{ uri: profile.profile_photo_url }}
                  style={styles.avatar}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>
                    {name[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}

              {/* Name */}
              <Text style={styles.name}>{name}</Text>

              {/* Location + milestone row */}
              <View style={styles.pillRow}>
                {/* Location bubble */}
                {(locationText || isTraveling) && (
                  <View style={styles.locationBubble}>
                    {isTraveling ? (
                      <Plane size={14} color={Colors.terracotta} />
                    ) : (
                      <Home size={14} color={Colors.terracotta} />
                    )}
                    <Text style={styles.locationText}>
                      {isTraveling
                        ? locationText
                          ? `Just traveling through ${locationText}`
                          : 'Just traveling through'
                        : locationText}
                    </Text>
                  </View>
                )}

                {/* No location at all */}
                {!locationText && !isTraveling && (
                  <View style={styles.locationBubble}>
                    <MapPin size={14} color={Colors.textLight} />
                    <Text style={[styles.locationText, { color: Colors.textLight }]}>
                      Location not set
                    </Text>
                  </View>
                )}

                {/* Milestone mark pill */}
                {marks?.highest_milestone_slug && marks.highest_milestone_icon && (
                  <View style={styles.milestonePill}>
                    <MarkIcon iconName={marks.highest_milestone_icon} size={20} />
                    <Text style={styles.milestonePillText}>{marks.highest_milestone_name}</Text>
                  </View>
                )}
              </View>

              {/* Visitor tag */}
              {isVisitor && (
                <View style={styles.visitorRow}>
                  <View style={styles.visitorBubble}>
                    <Text style={styles.visitorText}>visiting LA</Text>
                  </View>
                </View>
              )}

              {/* Fun fact */}
              {profile?.fun_fact ? (
                <View style={styles.funFactWrap}>
                  <Text style={styles.funFactLabel}>Fun fact</Text>
                  <Text style={styles.funFact}>{profile.fun_fact}</Text>
                </View>
              ) : null}

              {/* Pinned identity mark */}
              {marks?.pinned_identity_slug && marks.pinned_identity_icon && (
                <TouchableOpacity
                  style={styles.identityMarkWrap}
                  onPress={() => setIdentityExpanded(!identityExpanded)}
                  activeOpacity={0.7}
                >
                  <View style={styles.identityPill}>
                    <MarkIcon iconName={marks.pinned_identity_icon} size={20} />
                    <Text style={styles.identityPillText}>{marks.pinned_identity_name}</Text>
                  </View>
                  {identityExpanded && (
                    <View style={styles.identityExpanded}>
                      <View style={styles.identityExpandedIcon}>
                        <MarkIcon iconName={marks.pinned_identity_icon} size={40} />
                      </View>
                      <Text style={styles.identityExpandedDesc}>
                        {marks.pinned_identity_description}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* Report / Block — hidden for own profile */}
              {userId && currentUserId && userId !== currentUserId && (onReport || onBlock) && (
                <View style={styles.actionRow}>
                  {onReport && (
                    <TouchableOpacity
                      accessibilityRole="button" accessibilityLabel={`Report ${name}`}
                      onPress={() => moderate(onReport)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionLinkText}>Report</Text>
                    </TouchableOpacity>
                  )}
                  {onBlock && (
                    <TouchableOpacity
                      accessibilityRole="button" accessibilityLabel={`Block ${name}`}
                      onPress={() => moderate(onBlock)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionLinkText}>Block</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    position: 'absolute', top: 4, right: 4, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 28,
    marginHorizontal: 40,
    alignItems: 'center',
    minWidth: 260,
    maxWidth: 320,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: Colors.parchment,
    marginBottom: 14,
  },
  avatarPlaceholder: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  locationBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.parchment,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  locationText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  visitorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: -6,
    marginBottom: 14,
  },
  visitorBubble: {
    backgroundColor: Colors.parchment,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  visitorText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  milestonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.parchment,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  milestonePillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  funFactWrap: {
    alignItems: 'center',
    marginTop: 4,
  },
  funFactLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  funFact: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
  },
  identityMarkWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  identityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.parchment,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  identityPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  identityExpanded: {
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  identityExpandedIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityExpandedDesc: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: '#9B8B7A',
    textAlign: 'center',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 20,
    paddingTop: 16,
  },
  actionLinkText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: '#9B8B7A',
  },
});
