/**
 * SuggestionCard — the co-attendance nudge: "You, Tyler, and Sara have done 4
 * plans together. Start a circle?" A warm, recognition-over-guilt prompt (gold
 * left accent is decorative; the CTA is a normal terracotta action). Dismiss is
 * a quiet "Not now".
 */
import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
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
}: {
  suggestion: CircleSuggestion;
  onStart: (s: CircleSuggestion) => void;
  onDismiss: (s: CircleSuggestion) => void;
}) {
  const people = suggestion.people;
  const faces = people.slice(0, CIRCLE_SUGGEST.maxFaces);
  const subject = oxford([COPY.circleSuggestYou, ...people.map(nameOf)]);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => onDismiss(suggestion)}
        hitSlop={10}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel={COPY.circleSuggestNotNow}
      >
        <X size={16} color={Colors.tertiary} strokeWidth={2} />
      </Pressable>

      <View style={styles.faces}>
        {faces.map((p, i) => (
          <View key={p.user_id} style={[styles.faceWrap, i > 0 && styles.faceOverlap]}>
            {p.profile_photo_url ? (
              <Image source={{ uri: p.profile_photo_url }} style={styles.face} />
            ) : (
              <View style={[styles.face, styles.faceFallback]}>
                <Text style={styles.faceInitial}>{nameOf(p)[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <Text style={styles.body}>{COPY.circleSuggestBody(subject, suggestion.shared_count)}</Text>

      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            hapticSelection();
            onStart(suggestion);
          }}
          style={({ pressed }) => [styles.start, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleSuggestStart}
        >
          <Text style={styles.startLabel}>{COPY.circleSuggestStart}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDismiss(suggestion)}
          style={styles.notNow}
          accessibilityRole="button"
          accessibilityLabel={COPY.circleSuggestNotNow}
        >
          <Text style={styles.notNowLabel}>{COPY.circleSuggestNotNow}</Text>
        </Pressable>
      </View>
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
  notNow: { paddingVertical: 10 },
  notNowLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
});
