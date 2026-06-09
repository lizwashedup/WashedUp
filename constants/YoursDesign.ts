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

// ── Justified mosaic grid (Phase 3) ───────────────────────────────────────
export const MOSAIC = {
  targetRowHeight: 180,     // Ideal row height before scaling to fill width
  gap: 2,                   // Gap between tiles (tight, Google Photos style)
  tileRadius: 3,            // Per-tile corner radius
  edgePadding: 4,           // Horizontal inset from the screen edge
  minAspect: 0.6,           // Clamp floor (tall photos) so tiles don't get absurd
  maxAspect: 2.4,           // Clamp ceiling (panoramas) so one tile can't dominate
  fallbackAspect: 1,        // Square, for NULL/garbage dims (existing rows, EXIF fails)
  overlayFontSize: 10,      // Uploader-name whisper
  playIconSize: 30,         // Video play badge
} as const;

// ── People hub search field ───────────────────────────────────────────────
// A persistent field at the top of the People hub: filters the people you
// already have, and resolves an exact handle for someone new.
export const SEARCH = {
  fieldHeight: 44,
  fieldRadius: 12,
  iconSize: 18,
  horizontalInset: 16,   // Matches LAYOUT.gridHorizontalMargin
} as const;

// ── "you & [name]" keep page geometry ─────────────────────────────────────
// Two photos lean toward a central italic ampersand (the most analog
// gesture in the brand). The lean is a small symmetric rotation with the
// inner edges overlapping behind the "&".
export const KEEP = {
  heroPhoto: 92,            // Diameter (pt) of each leaning hero photo
  heroLeanDeg: 7,           // Symmetric inward tilt (left +, right -)
  heroOverlap: 14,          // Inner-edge overlap (pt) so photos meet at the &
  ampersandSize: 34,        // Cormorant italic "&" between the photos
  heroToName: 14,           // Gap from photos down to "you and [name]"
  statGap: 28,              // Horizontal gap between the three hero stats
  timelineDot: 22,          // Diameter of a timeline node
  timelineDotIcon: 14,      // Icon inside a timeline node
  timelineLineWidth: 1.5,   // The vertical spine connecting nodes
  timelineRowGap: 18,       // Vertical gap between timeline rows
} as const;

// ── Circles directory + row geometry ──────────────────────────────────────
// The Yours > Circles tab is a thin list. A circle cover is a rounded SQUARE
// (not a round avatar) so a circle row reads as "a place" and never gets
// mistaken for a person's face in the People grid.
export const CIRCLE = {
  rowCover: 52,            // Cover thumb diameter in a directory row
  rowCoverRadius: 16,      // Soft-square cover corner radius
  rowVerticalPad: 14,      // Row top/bottom padding
  rowGap: 14,              // Cover to text column
  rowChevron: 18,          // Trailing chevron size
  dividerInset: 16,        // Left inset of the hairline divider
  monogramSize: 24,        // Cormorant italic monogram in a coverless cover
  createIcon: 22,          // Plus glyph in the "make a circle" affordance
  emptyIcon: 38,           // Glyph in the empty / need-people state
  emptyBubble: 84,         // Diameter of the empty-state icon bubble
  emptyBubbleRadius: 42,   // = emptyBubble / 2 (keep in lockstep to stay round)
  emptyBubbleGap: 20,      // Gap from the bubble down to the title
  emptyPadH: 40,           // Horizontal inset of the empty-state column
  emptyPadBottom: 48,      // Optical lift off the tab bar
  emptyCtaW: 220,          // Empty-state CTA pill width (explicit: padding/minHeight
  emptyCtaH: 52,           // collapse to text size in this centered column; the
                           // sibling iconBubble paints only with explicit w+h)
} as const;

// ── Circles directory cards (the rich Yours > Circles list) ───────────────
// Each circle is a white rounded card (NOT a thin row): a leading gold monogram
// square (or cover photo), a serif-italic name + people-count meta, and an
// overlapping member-avatar row. A summary header card sits above the list with
// the count label, tagline, and a branded "New circle" button.
export const CIRCLE_DIR = {
  // Summary header card
  headerMarginH: 16,
  headerMarginTop: 12,
  headerRadius: 16,
  headerPadV: 16,
  headerPadH: 16,
  headerLabelGap: 6,    // Uppercase label down to the tagline
  ctaWidth: 136,        // Explicit fill on the inner View (a bare Pressable pill
  ctaHeight: 44,        // collapses as a flex child; the fill needs concrete w+h)
  ctaGap: 6,            // Plus icon to label
  ctaIcon: 16,
  // Circle card
  cardMarginH: 16,
  cardGap: 12,          // Vertical gap between cards
  cardRadius: 16,
  cardPadV: 16,
  cardPadH: 16,
  cover: 60,            // Leading monogram / cover square
  coverRadius: 16,
  monogram: 26,
  coverToText: 14,      // Cover square to the name/meta column
  nameToMeta: 4,
  topToAvatars: 14,     // Name/meta row down to the avatar stack
  // Member-avatar stack
  avatar: 32,
  avatarOverlap: 11,    // Negative margin between overlapping faces
  avatarBorder: 2,      // Card-colored ring separating overlapping faces
  maxFaces: 5,          // Faces shown before the "+N" overflow chip
} as const;

// ── Circle home (the stacked surface on Chats) ────────────────────────────
// The circle home is one surface: a noticeboard (cover, members, plans, the
// reserved Room slot) stacked above the persistent circle chat.
export const CIRCLE_HOME = {
  coverHero: 64,           // Cover squircle at the top of the home
  coverHeroRadius: 20,
  coverMonogram: 30,       // Monogram inside a coverless hero cover
  headerVPad: 12,          // Top-bar vertical padding
  headerIcon: 24,          // Back chevron / overflow glyph
  memberAvatar: 44,        // Members-row avatar diameter
  memberChipWidth: 60,     // Member chip width (avatar + breathing room for the name)
  memberChipGap: 16,       // Gap between member chips
  memberNameGap: 6,        // Avatar to name (under it)
  sectionGapV: 24,         // Vertical gap between noticeboard sections
  sectionPadH: 16,         // Horizontal inset of noticeboard content
  sectionLabelGap: 12,     // Section label to its content
  slotRadius: 16,          // Plan / room slot card radius
  slotPadV: 18,            // Vertical padding inside a slot card
  slotPadH: 16,
  roomDashWidth: 1.5,      // The Room reserved-slot dashed border width
  roomIcon: 20,            // Glyph in The Room slot
  emptyPlanIcon: 22,
} as const;

// (CIRCLE_CHAT tokens were retired with the standalone circle chat; circles
// now render the shared <ChatThread>, which carries its own geometry.)

// ── Create-circle flow (3-step wizard) ────────────────────────────────────
export const CIRCLE_CREATE = {
  coverPreview: 88,        // Live monogram cover preview on the identity step
  coverPreviewRadius: 24,
  coverMonogram: 40,
  stepDot: 6,              // Progress dot
  stepDotGap: 6,
  fieldRadius: 12,
  fieldMinHeight: 48,
  descMinHeight: 84,
  pickAvatar: 48,          // People-picker avatar
  pickCheck: 22,           // Selected check size
  pickRowPadV: 10,
  optionRadius: 16,        // Permission option card
  optionPadV: 16,
  optionPadH: 16,
  footerBtnHeight: 52,
} as const;

// ── Co-attendance suggestion card ─────────────────────────────────────────
export const CIRCLE_SUGGEST = {
  cardRadius: 16,
  cardPadV: 16,
  cardPadH: 16,
  cardMarginH: 16,
  goldAccentWidth: 3,   // Decorative warm-nudge left border (gold, not a CTA)
  avatar: 34,
  avatarOverlap: 10,
  maxFaces: 3,
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
