import { PageAction } from '../../creator/pages/PageFrame';
/**
 * SuggestionCard - the co-attendance nudge: "You, Tyler, and Sara have done 4
 * plans together. Start a circle?" A warm, recognition-over-guilt prompt.
 * The refined surface uses sunset gold with a terracotta action; the original
 * appearance retains its decorative gold edge. Dismiss is a quiet "Not now".
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_SUGGEST } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { CircleSuggestion, SuggestionPerson } from '../../../lib/circles/types';

function nameOf(p: SuggestionPerson): string {
  return p.first_name_display?.trim() || p.handle?.trim() || 'Someone';
}

/** Oxford-comma join: ["You","Tyler","Sara"] -> "You, Tyler, and Sara". */
function oxford(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export default function SuggestionCard({
  suggestion,
  onStart,
  onDismiss,
  appearance,
  dismissPending = false,
  dismissError = null,
}: {
  suggestion: CircleSuggestion;
  onStart: (s: CircleSuggestion) => void;
  onDismiss: (s: CircleSuggestion) => void;
  appearance?: { fonts: AfterglowFontFamilies };
  dismissPending?: boolean;
  dismissError?: string | null;
}) {
  const viewStyles = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const people = suggestion.people ?? []; // defensive: never crash the tab if the RPC omits it
  const faces = people.slice(0, CIRCLE_SUGGEST.maxFaces);
  const subject = oxford([COPY.circleSuggestYou, ...people.map(nameOf)]);
  const [startPressed, setStartPressed] = useState(false);
  const body = appearance && people.length === 0
    ? `You’ve shared ${suggestion.shared_count} ${suggestion.shared_count === 1 ? 'plan' : 'plans'} with this group.`
    : COPY.circleSuggestBody(subject, suggestion.shared_count);

  return (
    <View style={viewStyles.card}>
      {appearance && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { borderRadius: 20, overflow: 'hidden' }]}>
        <LinearGradient colors={[CreatorSurfaceColors.sunsetGoldLight, CreatorSurfaceColors.sunsetGoldMiddle, CreatorSurfaceColors.sunsetGoldWarm]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>}
      {!appearance && <Pressable
        disabled={dismissPending}
        onPress={() => onDismiss(suggestion)}
        hitSlop={10}
        style={viewStyles.dismiss}
        accessibilityRole="button"
        accessibilityLabel={COPY.circleSuggestNotNow}
      >
        <X size={16} color={Colors.tertiary} strokeWidth={2} />
      </Pressable>}

      <View style={viewStyles.faces}>
        {faces.map((p, i) => (
          <View key={p.user_id} style={[viewStyles.faceWrap, i > 0 && viewStyles.faceOverlap]}>
            {appearance ? <SuggestionFace key={`${p.user_id}:${p.profile_photo_url ?? ''}`} person={p} appearance={appearance}/> : p.profile_photo_url ? (
              <Image source={{ uri: p.profile_photo_url }} style={viewStyles.face} />
            ) : (
              <View style={[viewStyles.face, viewStyles.faceFallback]}>
                <Text style={viewStyles.faceInitial}>{nameOf(p)[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <Text style={viewStyles.body}>{body}</Text>

      <View style={viewStyles.actions}>
        {appearance ? <PageAction primary compact singleLine title={COPY.circleSuggestStart} disabled={dismissPending} onPress={() => { hapticSelection(); onStart(suggestion); }} /> : (
        <Pressable
          disabled={dismissPending}
          accessibilityState={{ disabled: dismissPending }}
          onPress={() => {
            hapticSelection();
            onStart(suggestion);
          }}
          onPressIn={() => setStartPressed(true)}
          onPressOut={() => setStartPressed(false)}
          style={[viewStyles.start, startPressed && viewStyles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleSuggestStart}
        >
          <Text numberOfLines={1} style={viewStyles.startLabel}>{COPY.circleSuggestStart}</Text>
        </Pressable>
        )}
        <Pressable
          disabled={dismissPending}
          accessibilityState={{ disabled: dismissPending, busy: dismissPending }}
          onPress={() => onDismiss(suggestion)}
          style={viewStyles.notNow}
          accessibilityRole="button"
          accessibilityLabel={dismissPending ? 'Dismissing…' : dismissError ? 'Try again to dismiss suggestion' : COPY.circleSuggestNotNow}
        >
          {dismissPending && <ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta}/>}
          <Text numberOfLines={1} style={viewStyles.notNowLabel}>{dismissPending ? 'Dismissing…' : dismissError ? 'Try again' : COPY.circleSuggestNotNow}</Text>
        </Pressable>
      </View>
      {dismissError && <Text accessibilityRole="alert" style={viewStyles.error}>{dismissError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: CIRCLE_SUGGEST.cardMarginH,
    marginTop: 12,
    paddingVertical: CIRCLE_SUGGEST.cardPadV,
    paddingHorizontal: CIRCLE_SUGGEST.cardPadH,
    borderRadius: CIRCLE_SUGGEST.cardRadius,
    backgroundColor: Colors.cardBg,
    borderLeftWidth: CIRCLE_SUGGEST.goldAccentWidth,
    borderLeftColor: Colors.goldAccent,
  },
  dismiss: { position: 'absolute', top: 12, right: 12, padding: 2 },
  faces: { flexDirection: 'row', marginBottom: 12 },
  faceWrap: {
    borderRadius: CIRCLE_SUGGEST.avatar / 2,
    borderWidth: 2,
    borderColor: Colors.cardBg,
  },
  faceOverlap: { marginLeft: -CIRCLE_SUGGEST.avatarOverlap },
  face: {
    width: CIRCLE_SUGGEST.avatar,
    height: CIRCLE_SUGGEST.avatar,
    borderRadius: CIRCLE_SUGGEST.avatar / 2,
    backgroundColor: Colors.inputBg,
  },
  faceFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  body: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.darkWarm,
    marginRight: 20,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },
  start: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.85 },
  startLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  notNow: { paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  error: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed, marginTop: 10 },
  notNowLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
});

function SuggestionFace({ person, appearance }: { person: SuggestionPerson; appearance: { fonts: AfterglowFontFamilies } }) {
  const [failed, setFailed] = useState(false);
  return person.profile_photo_url && !failed ? <Image source={{ uri: person.profile_photo_url }} style={styles.face} contentFit="cover" accessibilityIgnoresInvertColors onError={() => setFailed(true)}/> :
    <View style={[styles.face, styles.faceFallback, { backgroundColor: AfterglowColors.avatar }]}><Text style={{ ...AfterglowType.caption, fontFamily: appearance.fonts.semibold, color: AfterglowColors.muted }}>{Array.from(nameOf(person))[0]?.toUpperCase() ?? '?'}</Text></View>;
}
function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 8, marginBottom: 8, padding: 16, backgroundColor: AfterglowColors.white, borderRadius: 20, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge },
  body: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
  faceWrap: { ...styles.faceWrap, borderColor: AfterglowColors.white },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 14 },
  start: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: AfterglowColors.clay, borderRadius: 4, justifyContent: 'center' },
  startLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
  notNow: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  notNowLabel: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
  error: { ...AfterglowType.body, fontFamily: fonts.regular, color: Colors.errorRed, marginTop: 10 },
}); }
