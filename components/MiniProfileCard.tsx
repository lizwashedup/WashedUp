import { Image } from 'expo-image';
import { Home, MapPin, Plane } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
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
  const [profile, setProfile] = useState<MiniProfile | null>(null);
  const [marks, setMarks] = useState<ProfileMarks | null>(null);
  const [identityExpanded, setIdentityExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!visible || !userId) {
      setProfile(null);
      setMarks(null);
      setIdentityExpanded(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Try profiles table first (has the mini-profile fields)
        const { data, error } = await supabase
          .from('profiles')
          .select('first_name_display, profile_photo_url, neighborhood, is_traveling, fun_fact, city')
          .eq('id', userId)
          .single();

        if (!cancelled && data && !error) {
          setProfile(data as MiniProfile);
        } else if (!cancelled) {
          // Fallback to profiles_public (always readable, but lacks mini-profile fields)
          const { data: pub } = await supabase
            .from('profiles_public')
            .select('first_name_display, profile_photo_url, city')
            .eq('id', userId)
            .single();

          if (!cancelled && pub) {
            setProfile({
              first_name_display: pub.first_name_display,
              profile_photo_url: pub.profile_photo_url,
              city: pub.city ?? null,
              neighborhood: null,
              is_traveling: false,
              fun_fact: null,
            });
          }
        }

        // Fetch marks
        const { data: marksData } = await supabase.rpc('get_user_profile_marks', { p_user_id: userId });
        if (!cancelled && marksData?.[0]) {
          setMarks(marksData[0] as ProfileMarks);
        }
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [visible, userId]);

  if (!visible) return null;

  const name = profile?.first_name_display ?? 'Member';
  const locationText = profile?.neighborhood ?? profile?.city ?? null;
  const isTraveling = profile?.is_traveling ?? false;

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {loading ? (
            <ActivityIndicator size="large" color={Colors.terracotta} style={{ paddingVertical: 40 }} />
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
                    <MarkIcon iconName={marks.highest_milestone_icon} size={14} />
                    <Text style={styles.milestonePillText}>{marks.highest_milestone_name}</Text>
                  </View>
                )}
              </View>

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
                    <MarkIcon iconName={marks.pinned_identity_icon} size={16} />
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
                      onPress={() => { onClose(); setTimeout(() => onReport(userId, name), 150); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionLinkText}>Report</Text>
                    </TouchableOpacity>
                  )}
                  {onBlock && (
                    <TouchableOpacity
                      onPress={() => { onClose(); setTimeout(() => onBlock(userId, name), 150); }}
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
    color: '#D97746',
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
    color: '#D97746',
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
