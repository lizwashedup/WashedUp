/**
 * First-join surface layout tokens (spec b1/b3). Every numeric in the
 * first-join components traces back to a name here; nothing inline.
 */

export const FirstJoinDesign = {
  // Card shell
  cardRadius: 20, // rounded-2xl
  cardPadding: 16,
  cardGap: 12, // vertical rhythm between card sections
  cardShadowOpacity: 0.16, // one soft warm shadow (Colors.warmShadow carries the tint)
  cardShadowRadius: 12,
  cardShadowOffsetY: 4,
  cardElevationAndroid: 3,

  // Plan image (left) and its vibe-illustration fallback
  imageSize: 84,
  imageRadius: 14,
  vibeIconSize: 30,

  // Creator row
  creatorAvatarSize: 24,
  creatorRowGap: 8,

  // Proof row (avatar cluster + facts)
  proofAvatarSize: 22,
  proofAvatarOverlap: 7,
  proofAvatarMax: 6,
  proofRowGap: 8,
  pillRadius: 999,
  pillPaddingH: 10,
  pillPaddingV: 4,
  pillIconSize: 12,

  // Gold big-room tag
  tagRadius: 999,
  tagPaddingH: 10,
  tagPaddingV: 3,

  // CTA (warm shadow per house button style: 0 2px 8px terracotta @ 30%)
  buttonRadius: 999, // pill, house style
  buttonPaddingV: 13,
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

  // Empty state
  emptyIconCircle: 96,
  emptyIconSize: 40,
  emptyTopGap: 64,
  emptyBodyTopGap: 20,
  emptyCtaTopGap: 24,
  emptyBodyMaxWidth: 280,
} as const;
