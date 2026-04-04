// WashedUp Design System — single source of truth
// Never hardcode colors, fonts, spacing, or shadows. Always import from here.

export const colors = {
  // Brand
  terracotta: '#B5522E',       // Primary brand, CTAs, large text 18pt+ only
  terracottaDark: '#A84B2A',   // Text on light backgrounds — passes WCAG AA (primary terracotta does NOT for small text)
  terracottaPressed: '#8E3E20', // Active/pressed button states
  gold: '#C5A55A',             // Accent, highlights, badges, wave decorations — NEVER use for text, fails contrast
  goldLight: '#D4BF82',        // Subtle decorative accent
  cream: '#FAF5EC',            // Primary app background
  dark: '#2C1810',             // Primary body text color
  warmGray: '#78695C',         // Secondary text, metadata, timestamps
  lightGray: '#A09385',        // Tertiary text, placeholders
  sage: '#6B8F71',             // Cool accent for nature/success-adjacent uses

  // Semantic backgrounds
  bgPrimary: '#FAF5EC',
  bgSurface: '#FFFFFF',
  bgSubtle: '#F5EDE0',
  bgAccent: '#B5522E',
  bgAccentSubtle: '#F5E8E2',

  // Semantic text
  textPrimary: '#2C1810',
  textSecondary: '#78695C',
  textTertiary: '#A09385',
  textAccent: '#A84B2A',
  textOnAccent: '#FFFFFF',

  // Borders
  borderDefault: '#E5DDD1',
  borderStrong: '#78695C',
  borderAccent: '#B5522E',
  borderSubtle: '#F0EBE4',

  // Status
  success: '#2D7A4F',
  successBg: '#E8F5ED',
  error: '#C43D2E',
  errorBg: '#FDE8E6',
  warning: '#C5A55A',
  warningBg: '#FDF6E3',
  info: '#4A7FA5',
  infoBg: '#E8F0F7',

  // Buttons
  buttonPrimary: '#B5522E',
  buttonPrimaryHover: '#A84B2A',
  buttonPrimaryPressed: '#8E3E20',
  buttonDisabledBg: '#D5CCC2',
  buttonDisabledFg: '#A09385',

  // Overlay
  overlay: 'rgba(44, 24, 16, 0.5)',
} as const;

export const fonts = {
  heading: 'PlusJakartaSans_600SemiBold',
  headingBold: 'PlusJakartaSans_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemiBold: 'DMSans_600SemiBold',
  logo: 'Cochin', // iOS system font, for wordmark only
} as const;

export const typography = {
  display: {
    fontFamily: fonts.headingBold,
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: 0.4,
  },
  h1: {
    fontFamily: fonts.headingBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: 0.36,
  },
  h2: {
    fontFamily: fonts.heading,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 0.35,
  },
  h3: {
    fontFamily: fonts.heading,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0,
  },
  bodyLarge: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.4,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.24,
  },
  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.08,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  overline: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

const shadowColor = '#8B5A3C'; // Warm brown — never use gray or black

export const shadows = {
  sm: {
    shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  md: {
    shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 5,
  },
} as const;

export const components = {
  button: {
    height: 48,
    heightSmall: 44,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xl,
  },
  card: {
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgSurface,
  },
  input: {
    height: 48,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  avatar: {
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80,
  },
  minTouchTarget: 44,
} as const;
