import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import { useProfileCard } from '../../../hooks/useProfileCard';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { usePeopleConnectionMutations, friendlyConnectionError, isObsoletePeopleConnection } from '../../../hooks/usePeopleConnectionMutations';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
export interface ProfileCardSheetProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  targetId: string | null;
  appearance?: { fonts: AfterglowFontFamilies };
}

/** Minimal face/history preview. Never render full-profile/private fields here. */
export default function ProfileCardSheet(props: ProfileCardSheetProps) {
  return props.visible ? <OpenProfileCardSheet key={JSON.stringify([props.userId, props.targetId])} {...props} /> : null;
}
function OpenProfileCardSheet(props: ProfileCardSheetProps) {
  const viewer = useObservedUser();
  const visitKey = useMemo(() => JSON.stringify([viewer.viewerId, viewer.epoch]), [viewer.viewerId, viewer.epoch]);
  return <ProfileCardVisit key={visitKey} {...props} viewer={viewer} />;
}
function ProfileCardVisit({ userId, targetId, onClose, appearance, viewer }: ProfileCardSheetProps & { viewer: ObservedUser }) {
  const fonts = appearance?.fonts;
  const styles = useMemo(() => fonts ? { ...baseStyles, ...profileAppearance(fonts) } : baseStyles, [fonts]);
  const mounted = useRef(false);
  const retired = useRef(false);
  const pending = useRef<object | null>(null);
  const latestClose = useRef(onClose); latestClose.current = onClose;
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<'requested' | 'connected' | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  const identityReady = !!userId && viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const currentIdentity = useRef(identityReady); currentIdentity.current = identityReady;
  const isCurrent = () => mounted.current && !retired.current && currentIdentity.current && viewer.isCurrent();
  const profile = useProfileCard(identityReady ? userId : null, identityReady ? targetId : null);
  const { data: rawCard, isLoading, isFetching, isError, refetch } = profile;
  const card = rawCard?.user_id === targetId && !isError ? rawCard : null;
  const currentCard = useRef(card); currentCard.current = card;
  const { sendRequest } = usePeopleConnectionMutations(userId);
  const close = () => {
    if (!mounted.current || retired.current) return;
    retired.current = true; latestClose.current();
  };
  const add = async () => {
    const chosen = currentCard.current;
    if (!isCurrent() || pending.current || receipt || !targetId || !chosen || chosen.user_id !== targetId ||
      chosen.kind !== 'minimal' || isError) return;
    const attempt = {}; pending.current = attempt; setSending(true); setFailure(null);
    try {
      const outcome = await sendRequest.mutateAsync(
        { recipientId: targetId, context: 'handle_lookup' },
        { scope: { userId, isCurrent } },
      );
      if (!isCurrent() || pending.current !== attempt) return;
      if (outcome !== 'requested' && outcome !== 'now_connected' && outcome !== 'already_connected') {
        setFailure('We couldn’t confirm your request. Try again.');
        return;
      }
      setReceipt(outcome === 'requested' ? 'requested' : 'connected');
      close();
    } catch (error) {
      if (!isObsoletePeopleConnection(error) && isCurrent() && pending.current === attempt) setFailure(friendlyConnectionError(error));
    } finally {
      if (pending.current === attempt) {
        pending.current = null;
        if (isCurrent()) setSending(false);
      }
    }
  };
  const retryProfile = () => {
    if (!isCurrent() || !targetId || isFetching) return;
    void refetch();
  };
  const checkingIdentity = viewer.isLoading && !viewer.error;
  const profileLoading = identityReady && !!targetId && (isLoading || (isFetching && !card));
  const loadFailed = identityReady && !!targetId && isError;
  const available = identityReady && !loadFailed && !!card;
  const since = fmtDate(card?.since_date ?? null);
  const name = card?.first_name_display?.trim() || 'Someone';

  return (
    <BottomSheet visible onClose={close} heightPct={fonts ? undefined : 0.8} appearance={appearance}>
      <ScrollView style={fonts ? styles.compactScroll : undefined} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {checkingIdentity || profileLoading ? (
          <View style={styles.feedback} accessibilityLiveRegion="polite">
            <ActivityIndicator color={fonts ? AfterglowColors.clay : Colors.terracotta} accessibilityLabel="Loading profile" />
            <Text style={styles.summary}>Loading profile…</Text>
          </View>
        ) : viewer.error ? (
          <View style={styles.feedback} accessibilityLiveRegion="polite">
            <Text style={styles.feedbackTitle}>Couldn’t check your account.</Text>
            <Text style={styles.summary}>Try again to view this person.</Text>
            <Pressable style={styles.retryBtn} onPress={() => { if (mounted.current && !retired.current) void viewer.retry(); }} accessibilityRole="button" accessibilityLabel="Try again to check account">
              <Text style={styles.retryText} numberOfLines={1}>Try again</Text>
            </Pressable>
          </View>
        ) : loadFailed ? (
          <View style={styles.feedback} accessibilityLiveRegion="polite">
            <Text style={styles.feedbackTitle}>Couldn’t load this profile.</Text>
            <Text style={styles.summary}>Try again in a moment.</Text>
            <Pressable style={styles.retryBtn} onPress={retryProfile} disabled={!!isFetching} accessibilityRole="button" accessibilityLabel="Try again to load profile" accessibilityState={{ disabled: !!isFetching, busy: !!isFetching }}>
              <Text style={styles.retryText} numberOfLines={1}>{isFetching ? 'Loading…' : 'Try again'}</Text>
            </Pressable>
          </View>
        ) : !available ? (
          <View style={styles.feedback} accessibilityLiveRegion="polite">
            <Text style={styles.feedbackTitle}>This profile isn’t available.</Text>
            <Text style={styles.summary}>Go back to your people to keep looking.</Text>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              {fonts ? (
                <ProfilePhoto key={`${card.user_id}:${card.profile_photo_url ?? ''}`} name={name} photoUrl={card.profile_photo_url} fonts={fonts} />
              ) : (
                <YoursAvatar name={name} photoUrl={card.profile_photo_url} size={120} bucket="none" />
              )}
              <Text style={styles.name} accessibilityRole="header">{name}</Text>
              {card.shared_count > 0 && (
                <Text style={styles.summary}>
                  {`${fonts ? (card.shared_count === 1 ? '1 shared plan' : `${card.shared_count} shared plans`) : COPY.backlogPlansTogether(card.shared_count)}${since ? `, since ${since}` : ''}`}
                </Text>
              )}
            </View>
            {card.kind === 'minimal' && !receipt && (
              <>
                {failure && <Text style={styles.failure} accessibilityRole="alert">{failure}</Text>}
                <Pressable
                  style={[styles.primaryBtn, sending && styles.pendingBtn]}
                  onPress={() => { void add(); }} disabled={sending}
                  accessibilityRole="button" accessibilityLabel={sending ? `Sending request to ${name}` : `Add ${name}`}
                  accessibilityState={{ disabled: sending, busy: sending }}
                >
                  <Text style={styles.primaryText} numberOfLines={1}>{sending ? 'Sending…' : 'Add'}</Text>
                </Pressable>
              </>
            )}
            {receipt && <Text style={styles.summary} accessibilityLiveRegion="polite">{receipt === 'requested' ? 'Request sent.' : 'Added to your people.'}</Text>}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
function ProfilePhoto({ name, photoUrl, fonts }: { name: string; photoUrl: string | null; fonts: AfterglowFontFamilies }) {
  const [failed, setFailed] = useState(false);
  return <View style={photoStyles.frame}>
    {photoUrl && !failed ? <Image source={{ uri: photoUrl }} style={photoStyles.image} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photoUrl} onError={() => setFailed(true)} accessible={false} /> :
      <Text style={[photoStyles.initial, { fontFamily: fonts.semibold }]} accessible={false}>{name.slice(0, 1).toUpperCase()}</Text>}
  </View>;
}
const baseStyles = StyleSheet.create({
  content: { paddingBottom: 8 },
  compactScroll: { flexGrow: 0, flexShrink: 1 },
  header: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  name: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt, textAlign: 'center' },
  summary: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  primaryBtn: { backgroundColor: Colors.terracotta, borderRadius: 999, paddingVertical: 16, minHeight: 44, alignItems: 'center', marginTop: 28, marginBottom: 8 },
  primaryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  pendingBtn: { backgroundColor: Colors.tertiary },
  feedback: { marginVertical: 32, gap: 12, alignItems: 'center' },
  feedbackTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt, textAlign: 'center' },
  retryBtn: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: Colors.terracotta, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  failure: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed, marginTop: 20 },
});
function profileAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    header: { ...baseStyles.header, gap: 12, paddingTop: 12 },
    name: { ...baseStyles.name, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    summary: { ...baseStyles.summary, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    primaryBtn: { ...baseStyles.primaryBtn, backgroundColor: AfterglowColors.clay, borderRadius: 5, marginTop: 24 },
    primaryText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
    pendingBtn: { backgroundColor: AfterglowColors.muted },
    feedbackTitle: { ...baseStyles.feedbackTitle, ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    retryBtn: { ...baseStyles.retryBtn, borderColor: AfterglowColors.clay },
    retryText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
    failure: { ...baseStyles.failure, ...AfterglowType.body, fontFamily: fonts.regular },
  });
}
const photoStyles = StyleSheet.create({
  frame: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center' },
  image: { width: 96, height: 96, opacity: 1 },
  initial: { ...AfterglowType.identity, color: AfterglowColors.muted },
});
