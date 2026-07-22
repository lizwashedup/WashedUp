/**
 * D1 - the doc-78 event design law, as tokens (laws 1, 4, 5, 6).
 *
 * A MERGE, NOT A FORK, and after doc 80's binding, ZERO invented values.
 * Every entry below resolves to a shipped Colors.ts / Typography.ts
 * token; this module only says WHICH token each doc-78 law means for the
 * event surfaces. The warm-dark media zone is the shipped phone-auth
 * hero pattern reused verbatim (doc 80 section A) - it was already
 * tokenized, which is why law 1 needs no new palette work.
 *
 * The one hard rule this file encodes: terracotta appears on exactly one
 * thing per screen - the primary action - plus true scarcity and the
 * saved/published success state. A second solid terracotta button on a
 * screen is a law-1 violation; use EventDesign.action.secondary for it.
 */

import Colors from './Colors';
import { Fonts, FontSizes, LineHeights } from './Typography';

// ─── surfaces (law 1) ────────────────────────────────────────────────────

export const EventSurface = {
  /** the house base; the event surfaces stay inside the app */
  base: Colors.cream,
  /** cards and grouped fields on the base */
  card: Colors.white,
  /** the ONE place the base goes dark: cover, gallery, video. Never the
   *  page body, logistics, tickets, or forms (the dark-island rejection).
   *  doc 80: the shipped phone-auth hero ground, reused verbatim. */
  media: Colors.darkWarm,
  /** copy ON media, by weight (doc 80 section A) */
  onMedia: Colors.creamHigh,
  onMediaLabel: Colors.creamMedium,
  onMediaMuted: Colors.creamMuted,
  /** the cover's bottom gradient */
  mediaGradient: Colors.overlayBrandDeep,
  /** vignette that keeps copy legible over real photography */
  mediaVignette: Colors.overlayDark55,
  /** copy shadow over imagery */
  mediaTextShadow: Colors.shadowWarmDark,
  /** a control floating over media (lightbox close, play affordance) */
  mediaControl: Colors.surfaceTranslucent,
} as const;

// ─── the single accent (law 1) ───────────────────────────────────────────

export const EventAction = {
  /** the one loud thing per screen: get tickets / rsvp / publish */
  primary: Colors.terracotta,
  onPrimary: Colors.white,
  pressed: Colors.brandPressed,
  /** selected pill / callout ground */
  soft: Colors.brandSoft,
  /** drag-over and focus hints inside the builders */
  hintBorder: Colors.brandBorderSoft,
  /** everything that is NOT the screen's single primary action. A second
   *  filled terracotta button is the most common law-1 violation. */
  secondaryBorder: Colors.border,
  secondaryLabel: Colors.darkWarm,
  /** true scarcity only - real inventory ("12 of 60 left"). Never a fake
   *  resetting countdown (law 10). */
  scarcity: Colors.terracotta,
  /** doc 80: app success is the GOLD family, never green and never a
   *  second accent - "saved / published", sold-and-confirmed */
  success: Colors.gold,
  successFill: Colors.goingConfirmedFill,
  /** specific, warm-tinted error (never errorRed on these surfaces) */
  error: Colors.errorBrand,
} as const;

// ─── type (law 4) ────────────────────────────────────────────────────────

export const EventType = {
  /** the confident display face: event titles + section heads */
  display: Fonts.display,
  displayBold: Fonts.displayBold,
  /** doc 80 section B: the wizard/section headlines in the creation flow
   *  keep the established phone-auth headline face */
  headline: Fonts.headline,
  /** the legible body face: everything else */
  body: Fonts.sans,
  bodyMedium: Fonts.sansMedium,
  bodyBold: Fonts.sansBold,
  /** law 4: body never below 16px. FontSizes.bodyLG IS 16 - the floor. */
  bodyMinSize: FontSizes.bodyLG,
  titleSize: FontSizes.displayXL,
  titleLineHeight: LineHeights.displayXL,
} as const;

// ─── spacing (doc 78 §1: a strict scale) ─────────────────────────────────

export const EventSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  xxl: 64,
} as const;

// ─── the cover ratio (doc 80 section D, item 1) ──────────────────────────

/**
 * HELD, pending Liz: the ratio is being revised off 2:1 to portrait 4:5
 * or square 1:1. Every cover surface reads THIS constant, so calling it
 * is a one-line change, and nothing downstream hardcodes a shape. Until
 * it is called, the form must not promise a ratio in copy - a promise we
 * are about to break is worse than no promise.
 */
export const COVER_ASPECT_PENDING = true;
/** the interim preview shape only; NOT a ruling and NOT shown as copy */
export const COVER_ASPECT_INTERIM = 4 / 5;

// ─── motion (law 5: three motions, nothing else animates) ────────────────

export const EventMotion = {
  /** 1. content entering view */
  riseFade: { durationMs: 260, translateY: 8 },
  /** 2. the CTA press state */
  press: { durationMs: 120, scale: 0.97 },
  /** 3. the ONE signature beat: "your event is live" - doc 80 section D
   *  ratifies a warm GOLD BLOOM (not confetti), so it reads as the house
   *  success family rather than a second accent */
  published: { durationMs: 900, bloom: Colors.goingConfirmedFill },
} as const;
