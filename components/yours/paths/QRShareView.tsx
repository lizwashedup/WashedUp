import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { supabase } from '../../../lib/supabase';
import { useReferral } from '../../../hooks/useReferral';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import type { PeopleConnectionScope } from '../../../hooks/usePeopleConnectionMutations';
import { buildReferralLink } from '../../../lib/yours/invite';

type Props = { userId: string; appearance?: { fonts: AfterglowFontFamilies }; operationScope?: PeopleConnectionScope };
/** The same existing /r code as text invites. The receiver opens/accepts the
 * existing invitation journey; displaying or scanning is not mutual acceptance. */
export default function QRShareView(props: Props) {
  const viewer = useObservedUser();
  return <QRVisit key={JSON.stringify([props.userId, viewer.viewerId, viewer.epoch])} {...props} viewer={viewer}/>;
}
function QRVisit({ userId, appearance, operationScope, viewer }: Props & { viewer: ObservedUser }) {
  const { ensureReferralCode } = useReferral(), { width } = useWindowDimensions();
  const [result, setResult] = useState<{ link: string; name: string | null; photo: string | null } | null>(null);
  const [failure, setFailure] = useState(false), [retry, setRetry] = useState(0), [photoFailed, setPhotoFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const live = useRef(false), generation = useRef(0);
  const ready = viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent() && (!operationScope || operationScope.isCurrent());
  const currentReady = useRef(ready); currentReady.current = ready;
  const latestScope = useRef(operationScope); latestScope.current = operationScope;
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const current = () => live.current && currentReady.current && viewer.isCurrent() && (!latestScope.current || latestScope.current.isCurrent());
  const styles = useMemo(() => appearance ? { ...base, ...afterglow(appearance.fonts) } : base, [appearance?.fonts]);
  useEffect(() => {
    if (!ready) return;
    const attempt = ++generation.current; let cancelled = false;
    const owns = () => !cancelled && current() && generation.current === attempt;
    let identity: { name: string | null; photo: string | null } = { name: null, photo: null };
    setLoading(true); setFailure(false); setResult(null); setPhotoFailed(false);
    void (async () => {
      try {
        const code = await ensureReferralCode(userId, { isCurrent: owns });
        if (!owns()) return;
        setResult({ link: buildReferralLink(code), ...identity });
      } catch { if (owns()) setFailure(true); }
      finally { if (owns()) setLoading(false); }
    })();
    // Name and photo enrich the code; their loading or failure cannot block it.
    // Retain early metadata locally, and enrich an already-ready code in place.
    void (async () => {
      try {
        const profile = await supabase.from('profiles_public').select('first_name_display, profile_photo_url').eq('id', userId).maybeSingle();
        if (!owns() || profile.error) return;
        identity = { name: profile.data?.first_name_display ?? null, photo: profile.data?.profile_photo_url ?? null };
        setResult(value => owns() && value ? { ...value, ...identity } : value);
      } catch { /* Optional identity stays blank if its lookup fails. */ }
    })();
    return () => { cancelled = true; };
  }, [userId, ready, retry, ensureReferralCode, operationScope]);
  const again = () => { if (current() && !loading) setRetry(x => x + 1); };
  const feedback = (title: string, description: string, action?: () => void) => <View style={styles.feedback}>
    <Text style={styles.title}>{title}</Text><Text style={styles.hint}>{description}</Text>
    {action && <Pressable accessibilityRole="button" accessibilityLabel="Try again to load invite code" onPress={action} style={styles.retry}><Text numberOfLines={1} style={styles.retryText}>Try again</Text></Pressable>}
  </View>;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {viewer.isLoading ? <View style={styles.feedback}><ActivityIndicator accessibilityLabel="Loading invite code" color={appearance ? AfterglowColors.clay : Colors.terracotta}/><Text style={styles.hint}>Loading your code…</Text></View> : !ready ?
      feedback('Couldn’t check your account.', 'Try again to load your invite code.', () => { if (live.current) void viewer.retry(); }) : loading ?
      <View style={styles.feedback}><ActivityIndicator accessibilityLabel="Loading invite code" color={appearance ? AfterglowColors.clay : Colors.terracotta}/><Text style={styles.hint}>Loading your code…</Text></View> : failure || !result ?
      feedback('Couldn’t load your code.', 'Try again in a moment.', again) : <>
        {result.photo && !photoFailed ? <Image key={result.photo} source={{ uri: result.photo }} style={styles.avatar} contentFit="cover" accessible={false} onError={() => { if (current()) setPhotoFailed(true); }}/> :
          <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.initial}>{result.name?.trim().charAt(0).toUpperCase() || 'W'}</Text></View>}
        {!!result.name && <Text style={styles.title}>{result.name}</Text>}
        <View accessible accessibilityRole="image" accessibilityLabel="Your WashedUp invite QR code" style={styles.code}>
          <QRCode value={result.link} size={Math.max(96, Math.min(220, width - 104))} color={appearance ? AfterglowColors.ink : Colors.asphalt} backgroundColor={Colors.white}/>
        </View>
        <Text style={styles.hint}>Scan to open your invite in WashedUp.</Text>
        <Text style={styles.help}>New to WashedUp? Install the app, then scan again.</Text>
      </>}
  </ScrollView>;
}
const base = StyleSheet.create({
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 16, paddingBottom: 28 },
  feedback: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  avatar: { width: 72, height: 72, borderRadius: 36 }, avatarFallback: { backgroundColor: Colors.cream, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.secondary },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt, textAlign: 'center' },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.asphalt, textAlign: 'center' },
  help: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  code: { padding: 32, backgroundColor: Colors.white, borderRadius: 4 },
  retry: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1, borderColor: Colors.terracotta, borderRadius: 4 },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  avatarFallback: { ...base.avatarFallback, backgroundColor: AfterglowColors.avatar },
  initial: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.muted },
  title: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textAlign: 'center' },
  hint: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink, textAlign: 'center' },
  help: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center' },
  retry: { ...base.retry, borderColor: AfterglowColors.clay },
  retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
}); }
