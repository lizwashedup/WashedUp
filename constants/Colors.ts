/**
 * WashedUp — Golden Hour Design System
 * Brand colors v2.0
 */

const brand = {
  // ── Primary palette ──────────────────────────────────────────────────────
  terracotta: '#B5522E', // Primary accent — buttons, active states, CTA
  goldenAmber: '#F2A32D', // Secondary accent — badges, highlights
  goldenAmberTint15: 'rgba(242,163,45,0.15)', // goldenAmber @ 15% — pill backgrounds on featured cards
  birthdayPink: '#E8A0BF', // Birthday party featured tag — pink accent
  birthdayPinkTint15: 'rgba(232,160,191,0.15)', // birthdayPink @ 15% — pill backgrounds on birthday party cards
  parchment: '#F8F5F0', // App background
  asphalt: '#1E1E1E', // Primary text
  white: '#FFFFFF',

  // ── Supporting ───────────────────────────────────────────────────────────
  textMedium: '#1E1E1E', // Secondary text / meta
  textLight: '#4A4A4A', // Placeholder / inactive
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
  overlayWarm: 'rgba(181,82,46,0.18)',
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
  categoryComedy: '#B5522E',
  categorySports: '#5C7CBF',
  categoryWellness: '#5CBF9C',

  // ── Plan pin palette (map pins + category pills) ─────────────────────────
  pinMusic: '#8B6F5E',
  pinFood: '#B5522E',
  pinArt: '#9B7A4A',
  pinOutdoors: '#5E8B6F',
  pinComedy: '#C5A55A',
  pinFilm: '#6B4D7A',
  pinFitness: '#4A7C59',
  pinNightlife: '#7A4D6B',
  pinWellness: '#6B8B8B',
  pinBooks: '#8B7A5E',
  pinWashedupEvent: '#2C1810',
  pinBirthdayParty: '#D4BF82',
  pinHappeningNow: '#C5A55A',  // Live/happening-now map marker bg (semantic alias; same hex as pinComedy but different meaning)

  // ── Q2 palette ───────────────────────────────────────────────────────────
  darkWarm: '#2C1810',       // Primary text (warm dark)
  inkSoft: 'rgba(44,24,16,0.60)', // Softened dark ink - readable placeholders (darkWarm @60%), NOT pale grey; stays distinct from full-ink entered text
  secondary: '#78695C',      // Secondary text (dates, locations, metadata)
  tertiary: '#A09385',       // Tertiary text (muted labels, inactive tabs)
  iconMuted: '#C5C0B8',      // Muted icon color
  cream: '#FAF5EC',          // Screen background (cream)
  accentSubtle: '#F5E8E2',   // Vibe tag pill background
  goldAccent: '#D4BF82',     // Gold decorative accent (quote borders)
  quoteText: '#6B5D50',      // Creator message text
  dividerWarm: '#F5EDE0',    // Card footer border, subtle dividers
  warmTint: '#FFF8F5',       // Subtle warm background tint (active reaction badge)

  // ── Legacy alias (keep so old references don't break immediately) ─────────
  primaryOrange: '#B5522E',
  backgroundCream: '#F8F5F0',
  textDark: '#1E1E1E',
  cardBackground: '#FFFFFF',

  // ── Phone auth tokens (Golden Hour design system) ───────────────────────
  brand: '#B5522E',          // Primary CTA (alias of terracotta)
  brandPressed: '#8E3E20',   // Pressed CTA state
  brandSoft: '#F5E8E2',      // Selected pills, callout bg (alias of accentSubtle)
  brandDeep: '#6E2D17',      // Text-on-brand emphasis
  gold: '#C5A55A',           // Success state (NOT green), warnings
  creamWarm: '#F5EDDD',      // Secondary surface
  surface: '#FFFFFF',        // Card surface (alias of white)
  text1: '#2C1810',          // Primary text (alias of darkWarm)
  text2: '#78695C',          // Secondary text (alias of secondary)
  text3: '#A09385',          // Tertiary text (alias of tertiary)
  borderWarm: '#E5DDD1',     // Warm input/filter border
  errorBrand: '#C43D2E',     // Error states (warm-tinted, not errorRed)
  warmShadow: 'rgba(139, 90, 60, 0.16)',

  // ── Phone-auth hero overlays (gradients, vignettes, cream-on-dark text) ──
  // Used on phone-entry hero, migration-gate timeline, PhoneInput on dark.
  overlayWarmSoft: 'rgba(181,82,46,0.10)',      // brand @ 10% — secondary gradient layer
  brandBorderSoft: 'rgba(181,82,46,0.28)',      // brand @ 28% — soft brand-tinted border (timeline future dot)
  overlayBrandDeep: 'rgba(110,45,23,0.40)',     // brandDeep @ 40% — bottom gradient on hero
  overlayDark55: 'rgba(44,24,16,0.55)',         // text1 @ 55% — vignette on hero
  shadowWarmDark: 'rgba(44,24,16,0.35)',        // text1 @ 35% — text shadow on hero copy
  creamHigh: 'rgba(250,245,236,0.96)',          // cream @ 96% — emphasized links on dark hero
  creamMedium: 'rgba(250,245,236,0.92)',        // cream @ 92% — primary labels on dark hero
  creamMuted: 'rgba(250,245,236,0.78)',         // cream @ 78% — muted body text on dark hero
  surfaceTranslucent: 'rgba(255,255,255,0.96)', // surface @ 96% — input bg over hero imagery
  whiteSoft: 'rgba(255,255,255,0.86)',          // white @ 86% — animated subline text on success-state bg (verify-code)
  goldBadgeSoft: 'rgba(197,165,90,0.18)',       // gold @ 18% — success badge background (verify-code)
  circleBadgeGoldTint: 'rgba(197,165,90,0.15)', // gold #C5A55A @ 15%: "from a circle" badge bg (badge spec; decorative tint only, never on text)
  scrimSepia: 'rgba(58,42,30,0.30)',            // warm sepia scrim behind the anchored MenuCard (never system gray-black)

  // ── Yours page rebuild ───────────────────────────────────────────────────
  // Activity-ring family. terracotta is the primary; the 75/50 mid states
  // are SIM-EYEBALL #1 (terracotta opacity vs goldenAmber — confirm on
  // device that mid rings read as "ring", not "alert").
  ringFull: '#B5522E',                          // terracotta — last 2 weeks
  ringHigh: 'rgba(181,82,46,0.70)',             // terracotta @ 70% — last month
  ringMid: 'rgba(181,82,46,0.40)',              // terracotta @ 40% — last 2 months
  ringLow: '#C5C0B8',                           // iconMuted — 2-4 months ago
  ringGhost: 'rgba(160,147,133,0.40)',          // tertiary @ 40% — invited, dashed
  yoursGhostBg: '#E8DCC8',                       // Cream/Muted — ghost avatar fill
  yoursShimmer: '#E8DDD0',                        // shimmer / ghost placeholder block
  yoursOverlay85: 'rgba(248,245,240,0.85)',      // parchment @ 85% — fresh-start overlay
} as const;

// ── Interest category accent colors (phone auth onboarding) ───────────────
// Keyed by lowercase slug. Categories not in this map fall back to neutral pill.
export const INTEREST_COLORS = {
  music: '#7C5CBF',
  art: '#BF5CBF',
  food: '#BF7C5C',
  fitness: '#5CBFBF',
  nightlife: '#BF5C7C',
  outdoors: '#5CBF7C',
  film: '#5C7CBF',
  comedy: '#B5522E',
  wellness: '#5CBF9C',
  books: '#8B7A5E',
  sports: '#5C7CBF',
  community: '#9B7A4A',
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
