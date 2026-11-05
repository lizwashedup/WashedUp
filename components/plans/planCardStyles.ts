import { StyleSheet, type TextStyle, type ViewStyle, type ImageStyle } from 'react-native';
import Colors, { CreatorSurfaceColors, AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  cardPast: {
    opacity: 0.7,
  },

  // ── Creator row ──
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  creatorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  creatorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  creatorAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorDetails: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  creatorName: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: Colors.darkWarm,
    lineHeight: 18,
  },
  creatorSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creatorSubtext: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.tertiary,
    lineHeight: 16,
  },
  creatorMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  creatorMarkText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.terracotta,
    lineHeight: 14,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotsLeftBadge: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  spotsLeftBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.white,
    lineHeight: 14,
  },
  iconBtn: {
    padding: 4,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  activityTitle: {
    flex: 1,
    marginBottom: 0,
  },
  titleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  titleWithActions: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
  },
  titleActions: {
    flexShrink: 0,
    gap: 0,
    // Align the glyphs to the first title line while retaining full targets
    // inside the card's top padding. Long titles grow independently.
    marginTop: -10,
  },
  titleActionButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Body ──
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 18,
    color: Colors.darkWarm,
    lineHeight: 24,
    marginBottom: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  agePill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: CreatorSurfaceColors.goldLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    minHeight: 24,
    justifyContent: 'center',
  },
  agePillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.darkWarm,
    flexShrink: 1,
  },
  categoryPill: {
    backgroundColor: Colors.accentSubtle,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.terracotta,
    textTransform: 'capitalize',
    letterSpacing: 0.2,
  },
  featuredPill: {
    backgroundColor: Colors.goldenAmberTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  featuredPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.goldenAmber,
    letterSpacing: 0.2,
  },
  happeningNowPill: {
    backgroundColor: '#C5A55A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  happeningNowPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: '#2C1810',
    letterSpacing: 0.2,
  },
  womenOnlyPill: {
    backgroundColor: Colors.birthdayPinkTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  womenOnlyPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.birthdayPink,
    letterSpacing: 0.2,
  },
  // Badge A "from a circle": soft gold-tinted pill with a leading terracotta
  // circle-of-people glyph (badge spec). Gold is the decorative bg only; the
  // label stays warm-dark in DM Sans medium, never gold, per the palette rule.
  fromCircleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.circleBadgeGoldTint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  fromCircleBadgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.darkWarm,
    letterSpacing: 0.2,
  },
  // Badge B "private to circle": quiet neutral tag for a Just-us plan.
  privateCircleTag: {
    backgroundColor: Colors.dividerWarm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  privateCircleTagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  // Badge B "up to N others welcome": seats tag for an opened-up plan. Softly
  // terracotta-tinted (open door, never scarcity styling), secondary-text label.
  seatsCircleTag: {
    backgroundColor: Colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  seatsCircleTagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  // Badge B "{filled} of {size} in": capacity tag, terracotta-tinted with warm-dark
  // text (a touch stronger than the secondary-text seats line beside it).
  capacityCircleTag: {
    backgroundColor: Colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  capacityCircleTagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.darkWarm,
    letterSpacing: 0.2,
  },
  // "open to the feed" pip: a small terracotta dot + secondary label, signalling
  // an opened-up circle plan went public. No pill background, lightest of the row.
  openToFeedPip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  openToFeedDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.terracotta,
  },
  openToFeedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  birthdaySubtitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginTop: -2,
    marginBottom: 8,
  },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.goldAccent,
    paddingLeft: 10,
    marginBottom: 10,
  },
  quoteText: {
    fontSize: 13,
    color: Colors.quoteText,
    lineHeight: 19,
  },
  logisticsBlock: {
    marginBottom: 12,
  },
  logisticsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logisticsText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.secondary,
    flex: 1,
    lineHeight: 16,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.dividerWarm,
    paddingTop: 12,
    gap: 8,
  },
  creatorLastDecisionArea: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingBottom: 12,
  },
  creatorLastLogistics: {
    flexBasis: 165,
    flexGrow: 1,
    minWidth: 0,
  },
  creatorLastDecision: {
    borderTopWidth: 0,
    paddingTop: 0,
    paddingBottom: 0,
    flexDirection: 'column',
    flexWrap: 'nowrap',
    alignItems: 'flex-end',
    gap: 6,
  },
  creatorLastActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  creatorLastWideArea: { gap: 0 },
  creatorLastWideLogistics: { flexBasis: '100%' },
  creatorLastWideDecision: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    width: '100%',
    gap: 8,
  },
  creatorLastFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.dividerWarm,
    paddingTop: 12,
  },
  creatorLastRow: { marginBottom: 0 },
  activityAvatarStack: {
    height: 34,
    position: 'relative',
  },
  activityCompanionAvatar: {
    position: 'absolute',
    top: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: Colors.cardBg,
    opacity: 0.42,
  },
  activityCompanionPlaceholder: {
    position: 'absolute',
    top: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: Colors.cardBg,
    backgroundColor: Colors.borderWarm,
    opacity: 0.56,
  },
  activityCreatorLayer: {
    position: 'absolute',
    top: 0,
  },
  activityCreatorPressable: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  activityCreatorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: Colors.cardBg,
  },
  activityCreatorPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: Colors.cardBg,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotsLabel: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.secondary,
  },
  // Low-pressure circle-plan join line (the emotional core of the card).
  circleExplanation: { ...AfterglowType.caption, fontFamily: Fonts.sans, color: Colors.secondary, marginBottom: 10 },
  joinLine: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.darkWarm,
  },
  spotsNumber: {
    fontFamily: Fonts.sansBold,
    color: Colors.darkWarm,
  },
  ctaSpacer: {
    flex: 1,
  },
  ctaButton: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  ctaButtonOutline: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  ctaButtonOutlineText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  // Primary filled action on full+duplicatable cards — "Post your own" is
  // the behavior we want to encourage, so it's the loudest element here.
  postYourOwnBtn: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 8,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  postYourOwnBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  // Quiet text link — when "Post your own" is present it's the loud action,
  // so "Waitlist" steps back to a low-emphasis link (no bg, no border).
  waitlistQuietBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  waitlistQuietText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.dividerWarm,
    borderRadius: 999,
  },
  completedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.secondary,
  },
});

/** Presentation only: the existing card tree, data and callbacks stay shared. */
type PlanCardStyleMap = Record<keyof typeof styles, TextStyle & ViewStyle & ImageStyle>;
export function planCardAppearance(fonts?: AfterglowFontFamilies): PlanCardStyleMap {
  if (!fonts) return styles;
  const families: Record<string, string> = {
    [Fonts.sans]: fonts.regular,
    [Fonts.sansMedium]: fonts.medium,
    [Fonts.sansSemibold]: fonts.semibold,
    [Fonts.sansBold]: fonts.semibold,
    [Fonts.display]: fonts.regular,
  };
  const mapped = Object.fromEntries(Object.entries(styles).map(([name, source]) => {
    const style = StyleSheet.flatten(source);
    return [name, { ...style, ...('fontFamily' in style && typeof style.fontFamily === 'string'
      ? { fontFamily: families[style.fontFamily] ?? style.fontFamily } : {}) }];
  })) as typeof styles;
  return {
    ...mapped,
    card: { ...mapped.card, backgroundColor: AfterglowColors.white, borderRadius: 16,
      shadowOpacity: 0.035, shadowRadius: 5, elevation: 1 },
    creatorLastFooter: { ...mapped.creatorLastFooter, borderTopColor: AfterglowColors.subtleLine },
    creatorName: { ...mapped.creatorName, ...AfterglowType.body, color: AfterglowColors.ink },
    creatorLeft: { ...mapped.creatorLeft, minHeight: 44 },
    creatorSubtext: { ...mapped.creatorSubtext, ...AfterglowType.caption, color: AfterglowColors.muted },
    headerRight: { ...mapped.headerRight, gap: 0 },
    iconBtn: { ...mapped.iconBtn, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    title: { ...mapped.title, color: AfterglowColors.ink },
    agePillText: { ...mapped.agePillText, color: AfterglowColors.ink },
    birthdaySubtitle: { ...mapped.birthdaySubtitle, color: AfterglowColors.muted },
    quoteText: { ...mapped.quoteText, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    logisticsText: { ...mapped.logisticsText, ...AfterglowType.section, color: AfterglowColors.muted },
    spotsLabel: { ...mapped.spotsLabel, ...AfterglowType.section, color: AfterglowColors.muted },
    spotsNumber: { ...mapped.spotsNumber, color: AfterglowColors.ink },
    cardPast: { ...mapped.cardPast, opacity: 1 },
    joinLine: { ...mapped.joinLine, color: AfterglowColors.ink },
    footer: { ...mapped.footer, borderTopColor: AfterglowColors.subtleLine, flexWrap: 'wrap' },
    ctaButton: { ...mapped.ctaButton, minHeight: 44, justifyContent: 'center', borderRadius: 12,
      backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.clay, shadowOpacity: 0, elevation: 0 },
    ctaButtonText: { ...mapped.ctaButtonText, ...AfterglowType.section, color: AfterglowColors.clay },
    ctaButtonOutline: { ...mapped.ctaButtonOutline, minHeight: 44, justifyContent: 'center', borderRadius: 12,
      borderColor: AfterglowColors.clay },
    ctaButtonOutlineText: { ...mapped.ctaButtonOutlineText, ...AfterglowType.section, color: AfterglowColors.clay },
    postYourOwnBtn: { ...mapped.postYourOwnBtn, minHeight: 44, justifyContent: 'center', borderRadius: 12,
      backgroundColor: AfterglowColors.clay, shadowOpacity: 0, elevation: 0 },
    postYourOwnBtnText: { ...mapped.postYourOwnBtnText, ...AfterglowType.section, color: AfterglowColors.white },
    waitlistQuietBtn: { ...mapped.waitlistQuietBtn, minHeight: 44, justifyContent: 'center' },
    waitlistQuietText: { ...mapped.waitlistQuietText, ...AfterglowType.section, color: AfterglowColors.muted },
    completedText: { ...mapped.completedText, ...AfterglowType.section, color: AfterglowColors.muted },
  };
}
