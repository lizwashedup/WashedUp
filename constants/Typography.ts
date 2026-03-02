/**
 * WashedUp — Typography System
 *
 * Two-font system:
 *   Cormorant Garamond — editorial display, headings, plan titles
 *   DM Sans            — all UI text, body, buttons, labels
 */

export const Fonts = {
  display: 'CormorantGaramond_400Regular',
  displayBold: 'CormorantGaramond_700Bold',
  displayItalic: 'CormorantGaramond_400Regular_Italic',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansBold: 'DMSans_700Bold',
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
