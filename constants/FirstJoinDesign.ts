/**
 * First-join surface layout tokens (spec b1/b3). Every numeric in the
 * first-join components traces back to a name here; nothing inline.
 */

export const FirstJoinDesign = {
  // Card shell (white card, tight rhythm: the card must read in two seconds)
  cardRadius: 20, // rounded-2xl
  cardPadding: 14,
  cardGap: 12, // image column to text column, and content to button
  cardShadowOpacity: 0.16, // one soft warm shadow (Colors.warmShadow carries the tint)
  cardShadowRadius: 12,
  cardShadowOffsetY: 4,
  cardElevationAndroid: 3,

  // Plan image (left) and its imageless fallback: the brand three-wave
  // element, terracotta on the warm block, centered, ~40% of block width.
  imageSize: 84,
  imageRadius: 14,
  brandWavesWidthRatio: 0.4,
  brandWavesAspect: 400 / 227, // washedup-waves.png intrinsic w/h

  // Empty state: the full W-over-waves mark inside the icon circle.
  emptyMarkHeight: 52,
  emptyMarkAspect: 384 / 512, // washedup-mark.png intrinsic w/h

  // Creator row
  creatorAvatarSize: 24,
  creatorRowGap: 8,

  // Facts row ("{n} going" + gold scarcity pill when true)
  proofRowGap: 8,
  pillRadius: 999,
  pillPaddingH: 10,
  pillPaddingV: 4,
  pillIconSize: 12,

  // CTA: rounded-xl block button per the approved reference (NOT a stadium
  // pill), ~52pt tall, DM Sans 600. Warm shadow 0 2px 8px terracotta @ 30%.
  buttonRadius: 14,
  buttonHeight: 52,
  ctaShadowOpacity: 0.3,
  ctaShadowRadius: 8,
  ctaShadowOffsetY: 2,

  // Small gaps
  contentGap: 4, // between title / creator / meta lines
  pillIconGap: 3, // check icon to pill label
  avatarRingWidth: 1.5, // parchment ring separating clustered faces

  // Screen
  screenPaddingH: 20,
  screenGap: 16, // between stacked cards
  headlineSize: 32, // Cormorant italic, spec b3
  headlineLineHeight: 40,
  psCaptionSize: 12, // DM Sans 12, spec b3 caption line
  sublineTopGap: 8,
  sectionTopGap: 24,
  captionTopGap: 20,
  ghostTopGap: 12,
  laterTopGap: 16,
  laterBottomGap: 32,

  // Confirmation screen
  checkBadgeSize: 28,
  checkBadgeIconSize: 16,
  checkBadgeOffset: 2,
  watchingIconSize: 16,
  watchingLabelSpacing: 1.5, // house section-header letter spacing

  // Empty state
  emptyCardPadding: 28,
  emptyIconCircle: 96,
  emptyIconSize: 40,
  emptyTopGap: 64,
  emptyBodyTopGap: 20,
  emptyCtaTopGap: 24,
  emptyBodyMaxWidth: 280,
} as const;
