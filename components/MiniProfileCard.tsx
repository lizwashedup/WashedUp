import { Image } from 'expo-image';
import { Home, MapPin, Plane } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';

interface MiniProfileCardProps {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

interface MiniProfile {
  first_name_display: string | null;
  profile_photo_url: string | null;
  neighborhood: string | null;
  is_traveling: boolean;
  fun_fact: string | null;
  city: string | null;
}

export default function MiniProfileCard({ visible, userId, onClose }: MiniProfileCardProps) {
  const [profile, setProfile] = useState<MiniProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !userId) {
      setProfile(null);
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
          return;
        }

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

              {/* Fun fact */}
              {profile?.fun_fact ? (
                <View style={styles.funFactWrap}>
                  <Text style={styles.funFactLabel}>Fun fact</Text>
                  <Text style={styles.funFact}>{profile.fun_fact}</Text>
                </View>
              ) : null}
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
  locationBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.parchment,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    marginBottom: 14,
  },
  locationText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
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
});
