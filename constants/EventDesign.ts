/**
 * D1 - the doc-78 event design law, as tokens (laws 1, 4, 5, 6).
 *
 * A MERGE, NOT A FORK. The ruled base IS the house: Colors.cream
 * (#FAF5EC) and Colors.terracotta (#B5522E) already exist and already
 * mean what doc 78 says they mean, so this module COMPOSES them rather
 * than restating hexes. Only three things were genuinely missing and
 * live here: the warm-dark MEDIA surface (scoped to cover/gallery/video,
 * never the page), the strict spacing scale, and the three-motion vocab.
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
   *  page body, logistics, tickets, or forms (the dark-island rejection) */
  media: '#241A14',
  /** a hair lighter, for a media zone's own inner chrome (lightbox rails,
   *  video scrim) so controls read against the media surface */
  mediaRaised: '#31241C',
  /** text and icons sitting ON the media surface */
  onMedia: Colors.white,
  onMediaMuted: 'rgba(255,255,255,0.72)',
} as const;

// ─── the single accent (law 1) ───────────────────────────────────────────

export const EventAction = {
  /** the one loud thing per screen: get tickets / rsvp / publish */
  primary: Colors.terracotta,
  onPrimary: Colors.white,
  /** everything that is NOT the screen's single primary action. A second
   *  filled terracotta button is the most common law-1 violation. */
  secondaryBorder: Colors.border,
  secondaryLabel: Colors.darkWarm,
  /** true scarcity only - real inventory ("12 of 60 left"). Never a fake
   *  resetting countdown (law 10). */
  scarcity: Colors.terracotta,
  /** the saved / published success state */
  success: Colors.terracotta,
} as const;

// ─── type (law 4) ────────────────────────────────────────────────────────

export const EventType = {
  /** the confident display face: event titles + section heads */
  display: Fonts.displayBold,
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

// ─── motion (law 5: three motions, nothing else animates) ────────────────

export const EventMotion = {
  /** 1. content entering view */
  riseFade: { durationMs: 260, translateY: 8 },
  /** 2. the CTA press state */
  press: { durationMs: 120, scale: 0.97 },
  /** 3. the ONE signature beat: "your event is live" */
  published: { durationMs: 900 },
} as const;
