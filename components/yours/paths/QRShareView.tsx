import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { supabase } from '../../../lib/supabase';
import { useReferral } from '../../../hooks/useReferral';
import { buildReferralLink } from '../../../lib/yours/invite';

/**
 * Personal QR for in-person connecting. Encodes the SAME referral link as
 * the text invite (buildReferralLink — washedup.app/r/{code}), so QR and
 * text share one referral_code path; QR is just a different delivery.
 *
 * Branded per spec: terracotta code on a warm cream card with the user's
 * name + avatar above, not a generic black/white square.
 *
 * V2 FOLLOW-UP (not built — no infra exists yet, flagged in the audit):
 * the scan-side behaviors require deep-link work that does not exist on
 * this branch:
 *   - In-app scan: a deep-link route for washedup.app/r/{code} that, when
 *     opened by an authed user, resolves code -> user and calls
 *     send_people_request. Needs an app.json intentFilter/associatedDomain
 *     for /r/, a handler in app/_layout.tsx URL parsing, and a
 *     code -> user_id resolver RPC (none of these exist today).
 *   - No-app scan: deferred deep link -> App Store -> signup -> auto
 *     request. There is NO deferred-deep-link infrastructure in the repo
 *     (no Branch, no AsyncStorage pending-referral capture). The text
 *     invite's phone-hash path (link_referral_on_signup) can't be reused
 *     because a scanner's phone is unknown until signup. This is its own
 *     workstream; the display below is the in-scope deliverable.
 */
export default function QRShareView({ userId }: { userId: string }) {
  const { ensureReferralCode } = useReferral();
  const [link, setLink] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [code, profile] = await Promise.all([
          ensureReferralCode(userId),
          supabase
            .from('profiles_public')
            .select('first_name_display, profile_photo_url')
            .eq('id', userId)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setLink(buildReferralLink(code));
        setName(profile.data?.first_name_display ?? null);
        setPhoto(profile.data?.profile_photo_url ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, ensureReferralCode]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn't load your code. Try again.</Text>
      </View>
    );
  }

  if (!link) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.terracotta} />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>
            {(name ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      {!!name && <Text style={styles.name}>{name}</Text>}
      <View style={styles.card}>
        <QRCode
          value={link}
          size={220}
          color={Colors.terracotta}
          backgroundColor={Colors.cream}
        />
      </View>
      <Text style={styles.hint}>Have a friend scan this to add you</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: {
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.terracotta,
  },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  card: {
    backgroundColor: Colors.cream,
    borderRadius: 24,
    padding: 24,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  err: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
});
