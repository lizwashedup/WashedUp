/** Recipient-bound invitation claim. Preview may mark a link viewed; only Join accepts it. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack, Redirect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { FontSizes, LineHeights } from '../../../constants/Typography';
import { MEMBER_INVITES_ENABLED } from '../../../constants/FeatureFlags';
import { ScaledText as Text } from '../../../components/ScaledText';
import ProfileButton from '../../../components/ProfileButton';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { hapticSuccess } from '../../../lib/haptics';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { effectiveMemberInviteStatus } from '../../../lib/memberInvitePresentation';
import { previewMemberInvite, acceptMemberInviteByToken, MemberInviteAcceptanceUnknown, type MemberInvitePreview } from '../../../lib/memberInvites';

export default function MemberInviteClaimScreen() {
  return MEMBER_INVITES_ENABLED ? <EnabledClaim /> : <Redirect href="/(tabs)/plans" />;
}
function EnabledClaim() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const account = useObservedUser({ allowSignedOut: true });
  const focused = useIsFocused();
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <ClaimFrame signedIn={!!account.viewerId}>
    {account.isLoading ? <ActivityIndicator accessibilityLabel="Checking your account" color={Colors.terracotta} />
      : account.error ? <><Text style={[s.title, { fontFamily: fonts.display }]}>Couldn’t check your account</Text>
          <Text style={[s.body, { fontFamily: fonts.regular }]}>Try again to view this invitation.</Text><Action title="Try again" onPress={account.retry} /></>
      : focused ? <ClaimVisit key={`${typeof token === 'string' ? token : ''}:${account.epoch}`} token={typeof token === 'string' ? token : ''}
          viewerId={account.viewerId ?? null} accountIsCurrent={account.isCurrent} /> : null}
  </ClaimFrame>;
}
function ClaimFrame({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  const router = useRouter();
  return <SafeAreaView style={s.container} edges={['top', 'bottom']}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={s.header}>
      <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/plans')} style={s.headerBtn}>
        <ArrowLeft size={22} color={Colors.text1} strokeWidth={2.5} />
      </TouchableOpacity>
      {signedIn && <ProfileButton compact stacked />}
    </View>
    <ScrollView contentContainerStyle={s.content}>{children}</ScrollView>
  </SafeAreaView>;
}
function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} disabled={disabled} accessibilityState={{ disabled }}
    onPress={onPress} style={[s.primaryBtn, disabled && s.disabled]}><Text numberOfLines={1} adjustsFontSizeToFit style={[s.buttonText, { fontFamily: fonts.semibold }]}>{title}</Text></TouchableOpacity>;
}
function ClaimVisit({ token, viewerId, accountIsCurrent }: { token: string; viewerId: string | null; accountIsCurrent: () => boolean }) {
  const router = useRouter();
  const { fonts } = useAfterglowFonts(true, 'creator');
  const [preview, setPreview] = useState<MemberInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [acceptedCommunity, setAcceptedCommunity] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(false), readId = useRef(0), lock = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; readId.current++; }; }, []);
  const scope = useMemo<CreatorPageScope | null>(() => viewerId ? {
    userId: viewerId, isCurrent: () => mounted.current && accountIsCurrent(),
  } : null, [viewerId, accountIsCurrent]);
  const current = () => mounted.current && accountIsCurrent();
  const refresh = async () => {
    const id = ++readId.current;
    setLoading(true); setReadFailed(false); setError(null);
    try {
      const result = token.trim() ? await previewMemberInvite(token) : null;
      if (!current() || id !== readId.current) return;
      setPreview(result); setUnknown(false); setNow(Date.now());
    } catch {
      if (current() && id === readId.current) setReadFailed(true);
    } finally { if (current() && id === readId.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const accept = async () => {
    if (!scope?.isCurrent() || !preview || lock.current || unknown || loading || readFailed) return;
    const status = effectiveMemberInviteStatus(preview.status, preview.expiresAt);
    if (status !== 'pending' && status !== 'viewed') { setNow(Date.now()); return; }
    lock.current = true; setAccepting(true); setError(null);
    try {
      const result = await acceptMemberInviteByToken(token, scope, preview.communityId);
      if (!scope.isCurrent()) return;
      setAcceptedCommunity(result.communityId); hapticSuccess();
    } catch (failure) {
      if (!scope.isCurrent()) return;
      if (failure instanceof MemberInviteAcceptanceUnknown) { setUnknown(true); setError(failure.message); }
      else {
        const message = (failure as { message?: string })?.message;
        setError(message === 'this invite is not for you' ? 'This invitation is for a different account. Sign in with the account that was invited.'
          : message === 'Community unavailable' ? 'This community isn’t available to your account.'
          : message === 'cannot accept: banned from this community' ? 'You can’t join this community.'
          : message === 'this invite has expired' ? 'This invitation has expired. Ask for a new link.'
          : message === 'this invite is no longer available' ? 'This invitation is no longer available. Check its status.'
          : 'Couldn’t join right now. Check the invitation status and try again.');
      }
    } finally { if (scope.isCurrent()) { lock.current = false; setAccepting(false); } }
  };
  const title = [s.title, { fontFamily: fonts.display }], body = [s.body, { fontFamily: fonts.regular }];
  if (loading) return <ActivityIndicator accessibilityLabel="Loading invitation" color={Colors.terracotta} />;
  if (readFailed) return <><Text style={title}>Couldn’t load this invitation</Text><Text style={body}>Check your connection and try again.</Text><Action title="Try again" onPress={refresh} /></>;
  if (!preview) return <><Text style={title}>Invitation not found</Text><Text style={body}>Check that you opened the full link, or ask the creator for a new one.</Text></>;
  if (acceptedCommunity) return <><Text style={title}>You’re in</Text><Text style={body}>You’re a member of {preview.communityName}.</Text>
    <Action title="Open community" onPress={() => router.replace(`/community/${acceptedCommunity}` as never)} /></>;
  const status = effectiveMemberInviteStatus(preview.status, preview.expiresAt, now);
  if (status !== 'pending' && status !== 'viewed') return <><Text style={title}>{status === 'accepted' ? 'This invitation was already accepted' : status === 'expired' ? 'This invitation has expired' : 'This invitation was canceled'}</Text>
    <Text style={body}>{status === 'accepted' ? 'If you joined, you can find the community in Yours.' : `Ask ${preview.invitedByName} for a new link if you’d still like to join.`}</Text></>;
  return <><Text style={title}>Join {preview.communityName}</Text><Text style={body}>{preview.invitedByName} invited you.</Text>
    {!!preview.inviteMessage && <Text style={body}>{preview.inviteMessage}</Text>}
    {!!error && <Text accessibilityRole="alert" style={[body, s.error]}>{error}</Text>}
    {viewerId ? <>
      <Action title={accepting ? 'Joining…' : 'Join community'} disabled={accepting || unknown} onPress={accept} />
      {!!error && !accepting && <Action title="Check invitation status" onPress={refresh} />}
    </> : <><Text style={body}>Sign in to the account that was invited, then reopen this link.</Text>
      <Action title="Sign in" onPress={() => router.push('/(auth)/phone-entry')} /></>}
  </>;
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 16 },
  title: { fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Colors.text1 },
  body: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.text2 },
  error: { color: Colors.errorBrand },
  primaryBtn: { minHeight: 48, backgroundColor: Colors.brand, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.white, textAlign: 'center' },
});
