/**
 * WashedUp — Golden Hour Design System
 * Brand colors v2.0
 */

const brand = {
  // ── Primary palette ──────────────────────────────────────────────────────
  terracotta: '#D97746', // Primary accent — buttons, active states, CTA
  goldenAmber: '#F2A32D', // Secondary accent — badges, highlights
  parchment: '#F8F5F0', // App background
  asphalt: '#1E1E1E', // Primary text
  white: '#FFFFFF',

  // ── Supporting ───────────────────────────────────────────────────────────
  textMedium: '#4A4A4A', // Secondary text / meta
  textLight: '#777777', // Placeholder / inactive
  warmGray: '#9B8B7A', // Muted labels, handles, secondary UI
  border: '#E8E3DC', // Dividers, card borders (warm-tinted)
  cardBg: '#FFFFFF', // Card surface
  inputBg: '#F0EBE3', // Input field background

  // ── Semantic ─────────────────────────────────────────────────────────────
  successGreen: '#4CAF50',
  errorRed: '#E53935',
  errorBgLight: '#FEE2E2',
  cancelRed: '#DC2626',

  // ── Empty states / accents ───────────────────────────────────────────────
  emptyIconBg: '#FFF0E8',

  // ── Overlays & shadows ────────────────────────────────────────────────────
  overlayDark: 'rgba(0,0,0,0.5)',
  overlayMedium: 'rgba(0,0,0,0.45)',
  overlayDark40: 'rgba(0,0,0,0.4)',
  overlayDark60: 'rgba(0,0,0,0.6)',
  overlayDark25: 'rgba(0,0,0,0.25)',
  overlayWarm: 'rgba(217,119,70,0.18)',
  overlayDarker: 'rgba(0,0,0,0.95)',
  overlayLight: 'rgba(255,255,255,0.15)',
  overlayWhite: 'rgba(255,255,255,0.6)',
  overlayWhiteLight: 'rgba(255,255,255,0.85)',
  overlayWhite90: 'rgba(255,255,255,0.9)',
  shadowLight: 'rgba(0,0,0,0.2)',
  shadowMedium: 'rgba(0,0,0,0.15)',
  shadowBlack: '#000',
  separatorLight: '#EEEEEE',
  separatorDark: 'rgba(255,255,255,0.1)',
  textDark80: 'rgba(0,0,0,0.8)',
  codeHighlightLight: 'rgba(0,0,0,0.05)',
  codeHighlightDark: 'rgba(255,255,255,0.05)',

  // ── Category accents (chat list, etc.) ────────────────────────────────────
  categoryMusic: '#7C5CBF',
  categoryFilm: '#5C7CBF',
  categoryNightlife: '#BF5C7C',
  categoryFood: '#BF7C5C',
  categoryOutdoors: '#5CBF7C',
  categoryFitness: '#5CBFBF',
  categoryArt: '#BF5CBF',
  categoryComedy: '#D97746',
  categorySports: '#5C7CBF',
  categoryWellness: '#5CBF9C',

  // ── Legacy alias (keep so old references don't break immediately) ─────────
  primaryOrange: '#D97746',
  backgroundCream: '#F8F5F0',
  textDark: '#1E1E1E',
  cardBackground: '#FFFFFF',
} as const;

export default {
  ...brand,
  light: {
    text: brand.asphalt,
    background: brand.parchment,
    tint: brand.terracotta,
    tabIconDefault: brand.textLight,
    tabIconSelected: brand.asphalt,
  },
  dark: {
    text: brand.asphalt,
    background: brand.parchment,
    tint: brand.terracotta,
    tabIconDefault: brand.textLight,
    tabIconSelected: brand.asphalt,
  },
} as const;
