/**
 * One-time education pop-up for the rebuilt Yours screen
 * (WashedUp_Circles_Functional_Spec.md section 6, "Education and
 * onboarding"). Two variants:
 *
 *  - existingUser: "what moved" pop-up for returning users who already
 *    have people or plan history. Names what moved (Plans, now under
 *    Yours), points at the new People/Circles tabs, and prompts adding
 *    people.
 *  - newUser: a lighter guide for a brand-new user with nothing yet.
 *    Frames the loop as "go do something, then keep the people" instead of
 *    asking them to build a People graph from an empty state.
 *
 * Presentation only. The one-time "seen" trigger and bookkeeping live in
 * YoursScreen + lib/yours/tabsIntroSeen.ts; this component never touches
 * AsyncStorage itself.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import BottomSheet from '../primitives/BottomSheet';
import type { YoursIntroVariant } from '../../../lib/yours/tabsIntroSeen';

export default function YoursIntroPopup({
  visible,
  variant,
  circlesEnabled,
  onDismiss,
  onAddPeople,
}: {
  visible: boolean;
  /** Which copy/CTA set to show. Irrelevant while visible is false. */
  variant: YoursIntroVariant;
  /** Whether the Circles tab exists on this build (GROUPS_ENABLED). */
  circlesEnabled: boolean;
  /** Close with no follow-on action. */
  onDismiss: () => void;
  /** existingUser variant's primary CTA: close, then open the add-people paths sheet. */
  onAddPeople: () => void;
}) {
  const isExisting = variant === 'existingUser';

  return (
    <BottomSheet visible={visible} onClose={onDismiss}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>
          {isExisting ? COPY.introExistingEyebrow : COPY.introNewEyebrow}
        </Text>
        <Text style={styles.title}>
          {isExisting ? COPY.introExistingTitle : COPY.introNewTitle}
        </Text>

        {isExisting ? (
          <>
            <Text style={styles.body}>{COPY.introExistingBody(circlesEnabled)}</Text>
            <View style={styles.pillRow}>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{COPY.tabPeople}</Text>
              </View>
              {circlesEnabled && (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{COPY.tabCircles}</Text>
                </View>
              )}
            </View>

            <Pressable
              onPress={() => {
                hapticSelection();
                onAddPeople();
              }}
              accessibilityRole="button"
              accessibilityLabel={COPY.introExistingCta}
            >
              {({ pressed }) => (
                <View style={[styles.cta, pressed && styles.ctaPressed]}>
                  <Text style={styles.ctaLabel}>{COPY.introExistingCta}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              style={styles.dismissWrap}
              accessibilityRole="button"
              accessibilityLabel={COPY.introExistingDismiss}
            >
              <Text style={styles.dismiss}>{COPY.introExistingDismiss}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.body, styles.bodyLast]}>{COPY.introNewBody}</Text>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={COPY.introNewCta}
              style={styles.ghostCtaWrap}
            >
              <Text style={styles.ghostCtaLabel}>{COPY.introNewCta}</Text>
            </Pressable>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 8, paddingBottom: 8 },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
  },
  bodyLast: { marginBottom: 20 },
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 20 },
  pill: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  cta: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4, // Android: shadow* alone is invisible without elevation
  },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  dismissWrap: { alignItems: 'center', paddingVertical: 14 },
  dismiss: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.tertiary },
  // "Ghost" style per the design system (terracotta text, no fill/border):
  // the new-user variant's sole action is an acknowledgment, not a
  // data-changing request, so it stays off the filled-terracotta CTA look
  // reserved for real actions elsewhere in this file and the rest of Yours.
  ghostCtaWrap: { alignItems: 'center', paddingVertical: 14 },
  ghostCtaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
});
