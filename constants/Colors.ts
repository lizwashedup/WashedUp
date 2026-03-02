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
  textMedium: '#666666', // Secondary text / meta
  textLight: '#999999', // Placeholder / inactive
  warmGray: '#9B8B7A', // Muted labels, handles, secondary UI
  border: '#E8E3DC', // Dividers, card borders (warm-tinted)
  cardBg: '#FFFFFF', // Card surface
  inputBg: '#F0EBE3', // Input field background

  // ── Semantic ─────────────────────────────────────────────────────────────
  successGreen: '#4CAF50',
  errorRed: '#E53935',

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
