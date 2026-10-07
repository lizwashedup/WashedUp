import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { hapticSelection } from '../../../lib/haptics';
import YoursAvatar from '../primitives/YoursAvatar';
import { initialOf } from '../../../lib/yours/personDisplay';
import { COPY } from '../state/constants';
import type { IncomingRequest } from '../../../lib/yours/types';
import type { RequestAppearance } from './RequestStack';

export type RequestRowProps = {
  req: IncomingRequest; onAdd: () => void; onDecline: () => void;
  highlighted?: boolean; disabled?: boolean; appearance?: RequestAppearance;
  unavailable?: boolean; pendingAction?: 'accept' | 'decline'; error?: string; retryAction?: 'accept' | 'decline';
};
function RequestPhoto({ req, fonts }: { req: IncomingRequest; fonts: AfterglowFontFamilies }) {
  const [failed, setFailed] = useState(false); const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return <View style={rowAppearanceBase.photoFrame}>
    {req.profile_photo_url && !failed ? <Image style={rowAppearanceBase.photo} source={{ uri: req.profile_photo_url }}
      contentFit="cover" recyclingKey={`${req.requester_user_id}:${req.profile_photo_url}`} accessible={false}
      onError={() => { if (live.current) setFailed(true); }} /> :
      <Text accessible={false} style={[rowAppearanceBase.initial, { fontFamily: fonts.semibold }]}>{initialOf(req.first_name_display)}</Text>}
  </View>;
}
/** Explicit Add; decline retains its per-person inline confirmation. Pending
 * and errors are supplied by the account/visit-scoped RequestStack. */
export default function RequestRow({ req, onAdd, onDecline, highlighted, disabled, appearance, pendingAction, error, retryAction, unavailable: withdrawn }: RequestRowProps) {
  const identity = `${req.connection_id}:${req.requester_user_id}:${req.requested_at}`;
  const [confirmingFor, setConfirmingFor] = useState<string | null>(null);
  const confirming = confirmingFor === identity;
  const name = req.first_name_display?.trim() || 'Someone';
  const s = useMemo(() => appearance ? { ...styles, ...rowAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const busy = !!pendingAction, unavailable = !!disabled || busy || !!withdrawn;
  const add = () => { if (unavailable) return; hapticSelection(); onAdd(); };
  const askDecline = () => { if (unavailable) return; hapticSelection(); setConfirmingFor(identity); };
  const confirmDecline = () => { if (unavailable || confirmingFor !== identity) return; setConfirmingFor(null); onDecline(); };
  const addLabel = appearance ? 'Add' : COPY.requestAdd;
  return (
    <View style={[s.row, highlighted && s.rowHighlighted]} testID={`request-${req.connection_id}`}>
      <View style={s.head}>
        <View style={s.avatarRing}>
          {appearance ? <RequestPhoto key={`${identity}:${req.profile_photo_url}`} req={req} fonts={appearance.fonts} /> :
            <YoursAvatar name={req.first_name_display} photoUrl={req.profile_photo_url} size={52} bucket="none" />}
        </View>
        <View style={s.meta}>
          <Text style={s.name}>{name}</Text>
          {!!req.context_line && <View style={s.contextChip}><Text style={s.context} numberOfLines={2}>{req.context_line}</Text></View>}
        </View>
      </View>
      {withdrawn ? <Text style={s.feedback} accessibilityRole="alert" accessibilityLiveRegion="polite">This request is no longer available.</Text> : busy ? <Text style={s.feedback} accessibilityLiveRegion="polite">{pendingAction === 'accept' ? 'Adding…' : 'Declining…'}</Text> :
        error ? <Text style={s.feedback} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
      {withdrawn ? null : confirming && !busy ? (
        <View style={s.confirmation}>
          <Text style={s.confirmTitle}>{COPY.requestDeclineConfirmTitle(name)}</Text>
          <View style={s.confirmBtns}>
            <Pressable style={s.declineConfirm} disabled={unavailable} onPress={confirmDecline} accessibilityRole="button" accessibilityLabel={`Confirm decline ${name}`} accessibilityState={{ disabled: unavailable }}>
              <Text numberOfLines={1} style={s.declineConfirmText}>{COPY.requestDeclineConfirmYes}</Text>
            </Pressable>
            <Pressable style={s.keep} disabled={unavailable} onPress={() => setConfirmingFor(null)} accessibilityRole="button" accessibilityLabel={`Keep request from ${name}`} accessibilityState={{ disabled: unavailable }}>
              <Text numberOfLines={1} style={s.keepText}>{COPY.requestDeclineConfirmNo}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.actions}>
          <Pressable style={[s.add, unavailable && s.disabled]} onPress={add} disabled={unavailable} accessibilityRole="button" accessibilityLabel={error && retryAction === 'accept' ? `Try again to add ${name}` : `${addLabel} ${name}`}  accessibilityState={{ disabled: unavailable, busy }}>
            <Text numberOfLines={1} style={s.addText}>{error && retryAction === 'accept' ? 'Try again' : addLabel}</Text>
          </Pressable>
          <Pressable style={[s.decline, unavailable && s.disabled]} onPress={askDecline} disabled={unavailable} accessibilityRole="button" accessibilityLabel={error && retryAction === 'decline' ? `Try again to decline ${name}` : `${COPY.requestDecline} ${name}`}  accessibilityState={{ disabled: unavailable, busy }}>
            <Text numberOfLines={1} style={s.declineText}>{error && retryAction === 'decline' ? 'Try again' : COPY.requestDecline}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 14,
    // Soft terracotta lift so the card doesn't read flat on parchment.
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  // The person you tapped in from a notification floats up with a gold ring.
  rowHighlighted: {
    borderWidth: 1.5,
    borderColor: Colors.goldenAmber,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Warm gold ring so a request reads as an invitation, not a profile row.
  avatarRing: {
    padding: 3,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: Colors.goldenAmber,
  },
  meta: { flex: 1, gap: 6 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  contextChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  context: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmation: { gap: 10 },
  feedback: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  disabled: { opacity: 0.55 },
  add: {
    flex: 1,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  decline: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  declineText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  // Confirm-gated decline (still gold-never-red: neutral fill + quiet keep).
  confirmTitle: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  confirmBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  declineConfirm: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  declineConfirmText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  keep: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  keepText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
});

const rowAppearanceBase = StyleSheet.create({
  photoFrame: { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 54, height: 54, opacity: 1 },
  initial: { ...AfterglowType.contextTitle, color: AfterglowColors.muted },
});
function rowAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    row: { paddingVertical: 18, paddingHorizontal: 0, marginHorizontal: 20, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
    rowHighlighted: { backgroundColor: AfterglowColors.unread, borderBottomColor: AfterglowColors.clay },
    avatarRing: { padding: 0 },
    meta: { flex: 1, minWidth: 0, gap: 3 },
    name: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    contextChip: {},
    context: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    feedback: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    add: { flex: 1, minHeight: 44, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: AfterglowColors.clay },
    addText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
    decline: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
    declineText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
    confirmTitle: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    declineConfirm: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: AfterglowColors.line, borderRadius: 4, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    declineConfirmText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    keep: { flex: 1, minHeight: 44, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    keepText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay },
  });
}
