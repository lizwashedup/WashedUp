/**
 * WashedUp — Typography System
 *
 * Three-font system:
 *   Cormorant Garamond — editorial display, hero headlines, plan titles
 *   Plus Jakarta Sans  — onboarding section headlines (phone auth flow)
 *   DM Sans            — all UI text, body, buttons, labels
 */

export const Fonts = {
  display: 'CormorantGaramond_400Regular',
  displayBold: 'CormorantGaramond_700Bold',
  headline: 'PlusJakartaSans_700Bold',
  headlineMedium: 'PlusJakartaSans_500Medium',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemibold: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
} as const;

// Preserve the component contract while using the established WashedUp fonts.
// September 16 founder direction supersedes the alternate Mona Sans treatment.
export const AfterglowFonts = {
  regular: Fonts.sans,
  medium: Fonts.sansMedium,
  semibold: Fonts.sansSemibold,
  display: Fonts.displayBold,
} as const;
// September 18 creator refinement: restrained UI weight and an editorial title face.
// Staged on creator page journeys; existing Plans and onboarding keep their typography.
export const CreatorFonts = {
  regular: 'InterCreator400',
  medium: 'InterCreator500',
  semibold: 'InterCreator500',
  display: 'NewsreaderCreator500',
} as const;
export type AfterglowFontFamilies = Record<keyof typeof AfterglowFonts, string>;
export const AfterglowFallbackFonts: AfterglowFontFamilies = {
  regular: Fonts.sans, medium: Fonts.sansMedium,
  semibold: Fonts.sansSemibold, display: Fonts.displayBold,
};
export const AfterglowType = {
  pageTitle: { fontSize: 28, lineHeight: 34, letterSpacing: 0 },
  pageSection: { fontSize: 20, lineHeight: 24, letterSpacing: 0 },
  pageCheck: { fontSize: 56, lineHeight: 64 },
  screenTitle: { fontSize: 28, lineHeight: 34, letterSpacing: 0 },
  contextTitle: { fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  identity: { fontSize: 25, lineHeight: 29, letterSpacing: 0 },
  title: { fontSize: 16, lineHeight: 22, letterSpacing: 0 },
  body: { fontSize: 14, lineHeight: 20 },
  message: { fontSize: 16, lineHeight: 22 },
  section: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 17 },
  timestamp: { fontSize: 11, lineHeight: 16 },
} as const;

export const FontSizes = {
  displayXL: 38,
  displayLG: 28,
  displayMD: 22,
  displaySM: 18,
  bodyLG: 16,
  bodyMD: 14,
  bodySM: 13,
  caption: 11,
  micro: 10,
} as const;

export const LineHeights = {
  displayXL: 44,
  displayLG: 34,
  displayMD: 28,
  displaySM: 24,
  bodyLG: 24,
  bodyMD: 20,
  bodySM: 18,
  caption: 16,
} as const;

// Convenience aliases for design specs
export const displaySmall = { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, lineHeight: LineHeights.displaySM };
export const bodySmall = { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM };
export const bodyMedium = { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD };
export const labelSmall = { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, lineHeight: LineHeights.caption };

/** Conversation scale shared by Plan, Circle, DM and community rooms. */
export const ChatType = {
  message: { fontSize: 16, lineHeight: 22 },
  sender: { fontSize: 12, lineHeight: 17 },
  time: { fontSize: 10, lineHeight: 14 },
  quote: { fontSize: 13, lineHeight: 18 },
} as const;
