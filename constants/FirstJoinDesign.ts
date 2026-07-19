/**
 * First-join surface layout tokens (spec b1/b3). Every numeric in the
 * first-join components traces back to a name here; nothing inline.
 */

export const FirstJoinDesign = {
  // Card shell (white card, tight rhythm: the card must read in two seconds;
  // the whole card is tappable, and 3 cards + header + footer must fit one
  // 6.1" screen with no scrolling)
  cardRadius: 20, // rounded-2xl
  cardPadding: 16,
  imageTextGap: 12, // image column to text column
  contentRowGap: 8, // between text rows (fit-reduced from 10 per the fit rule)
  buttonTopGap: 12, // content block to button
  cardShadowOpacity: 0.16, // one soft warm shadow (Colors.warmShadow carries the tint)
  cardShadowRadius: 12,
  cardShadowOffsetY: 4,
  cardElevationAndroid: 3,

  // Plan image (left) and its imageless fallback: the brand three-wave
  // element, terracotta on the warm block, centered, ~40% of block width.
  imageSize: 56,
  imageRadius: 12,
  brandWavesWidthRatio: 0.4,
  brandWavesAspect: 400 / 227, // washedup-waves.png intrinsic w/h

  // Empty state: the full W-over-waves mark inside the icon circle.
  emptyMarkHeight: 52,
  emptyMarkAspect: 384 / 512, // washedup-mark.png intrinsic w/h

  // Creator row
  creatorAvatarSize: 18,
  creatorRowGap: 8,

  // Facts row ("{n} going" + gold scarcity pill when true)
  proofRowGap: 8,
  pillRadius: 999,
  pillPaddingH: 10,
  pillPaddingV: 4,
  pillIconSize: 12,

  // CTA: 44pt tall (Apple HIG minimum touch target), borderRadius 12,
  // DM Sans 600 at 15, inset from card edges by the card padding.
  // Warm shadow 0 2px 8px terracotta @ 30%.
  buttonRadius: 12,
  buttonHeight: 44,
  buttonFontSize: 15,
  ctaShadowOpacity: 0.3,
  ctaShadowRadius: 8,
  ctaShadowOffsetY: 2,

  // Card type scale (tight but legible; title stays the loudest element)
  titleSize: 16,
  titleLineHeight: 20,
  creatorTextSize: 13,
  creatorTextLineHeight: 18,
  metaTextSize: 12,
  metaTextLineHeight: 16,
  factsTextSize: 13,
  factsTextLineHeight: 17,

  // Small gaps
  pillIconGap: 3, // check icon to pill label
  avatarRingWidth: 1.5, // parchment ring separating clustered faces

  // Screen (everything from header to the later link fits 390x844 unscrolled)
  screenPaddingH: 20,
  screenGap: 9, // between stacked cards
  headlineSize: 32, // Cormorant italic, spec b3
  headlineLineHeight: 36,
  headlineTopGap: 0,
  sublineSize: 12,
  sublineLineHeight: 16,
  psCaptionSize: 12, // DM Sans 12, spec b3 caption line
  sublineTopGap: 2,
  sectionTopGap: 10,
  captionTopGap: 6,
  ghostTopGap: 2,
  ghostPadV: 4, // tap padding on the wishlist text button
  laterTopGap: 2,
  laterBottomGap: 6,

  // Confirmation screen
  checkBadgeSize: 28,
  checkBadgeIconSize: 16,
  checkBadgeOffset: 2,
  watchingIconSize: 16,
  watchingLabelSpacing: 1.5, // house section-header letter spacing

  // Empty state (padding sized so the wishlist CTA stays one line at 390pt)
  emptyCardPadding: 18,
  emptyIconCircle: 96,
  emptyIconSize: 40,
  emptyTopGap: 64,
  emptyBodyTopGap: 20,
  emptyCtaTopGap: 24,
  emptyBodyMaxWidth: 280,
} as const;
