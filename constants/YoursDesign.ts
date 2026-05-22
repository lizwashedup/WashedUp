/**
 * WashedUp — Yours page design tokens
 *
 * Visual layer source of truth for the Yours rebuild. Every Yours
 * component imports geometry and type slots from this file; nothing in
 * components/yours/** should hardcode a size, gap, radius, stroke width,
 * or font preset.
 *
 * Colors live in constants/Colors.ts (including the Yours-specific
 * ring / shimmer / overlay family). Animation timings, ring colors, and
 * copy live in components/yours/state/constants.ts. This file is purely
 * geometry + typography presets.
 *
 * Source: yours-page-product-spec.md — Design Implementation Reference
 * (lines 567-619) plus the Page Structure, Populated State, and
 * Profile Card sections for size details.
 */
import { Fonts, FontSizes, LineHeights } from './Typography';

// ── Avatar diameters (pt) ─────────────────────────────────────────────────
export const SIZES = {
  gridAvatar: 72,           // Populated grid (3-column)
  requestCardAvatar: 96,    // Incoming request card stack
  profileSheetAvatar: 120,  // ProfileCardSheet header
} as const;

// ── Grid + page geometry ─────────────────────────────────────────────────
export const LAYOUT = {
  gridColumns: 3,
  gridHorizontalMargin: 16,
  gridGutter: 12,
  planPreviewWidthRatio: 0.85,    // Horizontal-scroll plan cards in NewUserEmptyView
  profileSheetHeightRatio: 0.8,   // ProfileCardSheet sheet height
} as const;

// ── Corner radii (pt) ─────────────────────────────────────────────────────
export const RADII = {
  pill: 4,    // Avatar subtext pill (e.g. "Beach day, Sat")
  card: 16,   // Plan preview card, profile sheet card
  sheet: 16,  // Bottom-sheet top corners
} as const;

// ── Slot spacing (pt) ─────────────────────────────────────────────────────
export const SPACING = {
  avatarToName: 6,
  nameToSubtext: 2,
  inlineIconGap: 4,         // Gap between an inline icon and adjacent text
  addPillOffsetTop: 12,     // Drops the + add pill below the tabs baseline so future menu items have room above it
} as const;

// ── Lucide icon sizes ─────────────────────────────────────────────────────
export const ICON = {
  chevronInline: 14,        // Chevron paired with bodySM secondary text in a card
} as const;

// ── Album grid + polaroid card sizing ────────────────────────────────────
export const ALBUM = {
  photoAspectRatio: 1,      // Square; matches real polaroid prints (SX-70 era)
  minCardWidth: 140,        // Floor for the cardWidth clamp on narrow screens
  cardWidthRatio: 0.42,     // Of screen width; leaves room for gutters
  gridGap: 12,              // Horizontal gap between the two columns
  placeholderIconSize: 28,  // Icon in the "no uploads yet" card placeholder
  uploadPhotoCap: 20,       // Per-person photo cap (server-enforced); the "Add yours" pill hides at/above it
  ctaIconSize: 16,          // Icon size in the "Add yours" pill + the zero-upload banner
} as const;

// ── Activity ring strokes (color side lives in state/constants.ts) ────────
export const RING_STROKE = {
  fullPt: 2.5,
  highPt: 2,
  midPt: 1.5,
  lowPt: 1,
  ghostPt: 1,             // Dashed
  offsetFromAvatarPt: 3,  // Ring sits 3pt outside the avatar border
  startAngleDeg: -90,     // 12 o'clock; fills clockwise
} as const;

// ── Shimmer breathing (cycle ms in ANIM.shimmerCycleMs) ───────────────────
export const SHIMMER = {
  opacityFloor: 0.4,
  opacityCeiling: 0.7,
} as const;

// ── Typography presets (spread directly into Text style) ──────────────────
// heroDisplay sits between FontSizes.displaySM (18) and displayMD (22),
// so this single slot is custom; everything else composes from existing
// Typography.ts tokens.
export const TYPE = {
  heroDisplay: {
    fontFamily: Fonts.displayItalic,
    fontSize: 20,
    lineHeight: 26,
  },
  avatarName: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
  },
  avatarSubtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    lineHeight: LineHeights.caption,
  },
  pillLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.micro,
    lineHeight: 14,
  },
  requestBanner: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
  },
  freshSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
  },
  nearbyHeader: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
  },
} as const;
