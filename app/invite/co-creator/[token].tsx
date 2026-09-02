/**
 * Co-creator invite claim screen (R21). Reached via the
 * washedupapp://invite/co-creator/{token} deep link (lib/coCreatorInvites'
 * buildCoCreatorInviteLink). Preview is anon-callable and read-only --
 * opening this screen never consumes or grants the invite. Acceptance
 * always goes through accept_co_creator_invite() server-side, which is the
 * one and only place the binding check runs; this screen never decides
 * binding itself, it only shows what the server said.
 *
 * Behind CO_CREATOR_INVITES_ENABLED (constants/FeatureFlags.ts) -- a direct
 * deep link still resolves this route, but the screen renders nothing extra
 * while the flag is off (same "reachable by URL, no live affordance leads
 * here" posture as the rest of this feature).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack, Redirect } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { CO_CREATOR_INVITES_ENABLED } from '../../../constants/FeatureFlags';
import { friendlyError } from '../../../lib/friendlyError';
import { hapticSuccess } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import {
  previewCoCreatorInvite,
  acceptCoCreatorInviteByToken,
  type CoCreatorInvitePreview,
} from '../../../lib/coCreatorInvites';

function inviteRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'events': return 'Events';
    case 'member_care': return 'Member care';
    case 'finance': return 'Finance';
    case 'admin':
    case 'co_leader':
    default: return 'Admin';
  }
}
function roleAccessSummary(role: string | null | undefined): string {
  switch (role) {
    case 'events': return 'access to run events: create and edit them, tickets, and check-in.';
    case 'member_care': return 'access to the member roster: review who wants in, and moderate the chat spaces.';
    case 'finance': return 'access to the payouts and earnings for this community.';
    case 'admin':
    case 'co_leader':
    default: return 'full co-creator access: broadcasts, members, the page, and chat spaces.';
  }
}

export default function CoCreatorInviteClaimScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CoCreatorInvitePreview | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: userData }, previewResult] = await Promise.all([
        supabase.auth.getUser(),
        typeof token === 'string' ? previewCoCreatorInvite(token).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setSignedIn(!!userData.user);
      setPreview(previewResult);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = async () => {
    if (typeof token !== 'string' || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptCoCreatorInviteByToken(token);
      hapticSuccess();
      setAccepted(true);
    } catch (e) {
      // includes the "this invite is not for you" binding refusal -- shown
      // plainly rather than as a generic failure, since it is a meaningful,
      // expected outcome for someone who opened a forwarded link.
      setError(friendlyError(e, 'This invite could not be accepted.'));
    } finally {
      setAccepting(false);
    }
  };

  if (!CO_CREATOR_INVITES_ENABLED) return <Redirect href="/(tabs)/plans" />;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.text1} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.terracotta} />
        ) : !preview ? (
          <>
            <Text style={styles.title}>This invite isn&apos;t valid</Text>
            <Text style={styles.body}>It may have been canceled, or the link is incomplete.</Text>
          </>
        ) : accepted ? (
          <>
            <Text style={styles.title}>You&apos;re a co-creator</Text>
            <Text style={styles.body}>You're on the team at {preview.communityName}.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(creator)/community')}>
              <Text style={styles.primaryBtnText}>Go to the community</Text>
            </TouchableOpacity>
          </>
        ) : preview.status !== 'pending' ? (
          <>
            <Text style={styles.title}>
              {preview.status === 'accepted' ? 'This invite was already used' : preview.status === 'expired' ? 'This invite has expired' : 'This invite was canceled'}
            </Text>
            <Text style={styles.body}>Ask {preview.invitedByName} for a new one if you still want to help run {preview.communityName}.</Text>
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>{inviteRoleLabel(preview.role)} invite</Text>
            <Text style={styles.title}>{preview.invitedByName} invited you to help run {preview.communityName}</Text>
            {preview.targetHint && <Text style={styles.body}>Sent to {preview.targetHint}</Text>}
            <Text style={styles.body}>
              Accepting gives you {roleAccessSummary(preview.role)}
            </Text>

            {error && <Text style={styles.error}>{error}</Text>}

            {signedIn ? (
              <TouchableOpacity
                style={[styles.primaryBtn, accepting && styles.primaryBtnDisabled]}
                onPress={handleAccept}
                disabled={accepting}
              >
                {accepting ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.primaryBtnText}>Accept</Text>}
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.body}>Sign in or create an account with the contact this was sent to, then come back to this link to accept.</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/(auth)/phone-entry')}>
                  <Text style={styles.primaryBtnText}>Sign in or create an account</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  content: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  eyebrow: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.brand,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.text1,
  },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.text2 },
  error: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand },
  primaryBtn: {
    backgroundColor: Colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: Colors.brand,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
