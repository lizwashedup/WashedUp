import { Dimensions, StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export const baseStyles = StyleSheet.create({
  screenTitle: { ...AfterglowType.screenTitle, fontFamily: Fonts.sansBold, color: Colors.asphalt },
  feedback: { marginHorizontal: 20, marginBottom: 10, padding: 12, backgroundColor: Colors.inputBg, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  feedbackText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  feedbackAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  feedbackActionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  container: { flex: 1, backgroundColor: '#FAF5EC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 122,
    height: 28,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5DDD1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Full-width underline tabs ──
  // ── Filters ──
  filterRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 4,
    marginBottom: 12,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 20,
    backgroundColor: Colors.dividerWarm,
  },
  filterPillActive: {
    backgroundColor: Colors.terracotta,
  },
  filterPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.secondary,
    includeFontPadding: false,
  },
  filterPillTextActive: {
    color: Colors.white,
  },
  // ── Near-me radius presets + deny notice ──
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  radiusPill: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EDE0',
  },
  radiusPillActive: {
    backgroundColor: '#B5522E',
  },
  radiusPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: '#78695C',
    includeFontPadding: false,
  },
  radiusPillTextActive: {
    color: '#FFFFFF',
  },
  nearMeNotice: {
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F5EDE0',
  },
  nearMeNoticeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: '#78695C',
  },
  // ── List ──
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  featuredSection: {
    marginBottom: 20,
  },
  welcomeBannerOuter: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 14,
    borderRadius: 14,
    overflow: 'hidden',
  },
  welcomeBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
  },
  welcomeBannerLogo: {
    width: 18,
    height: 18,
    opacity: 0.9,
  },
  welcomeBannerText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text1,
  },
  welcomeBannerCloseHit: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  welcomeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
  },
  welcomeLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 40,
    backgroundColor: Colors.parchment,
  },
  welcomeLoadingLogo: {
    width: 132,
    height: 132,
  },
  welcomeLoadingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text2,
    letterSpacing: 0.3,
  },
  welcomeLoadingDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -8,
  },
  welcomeLoadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand,
  },
  featuredHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  featuredHeaderText: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.asphalt,
  },
  featuredSoloWrap: {
  },
  featuredScroll: {
    marginHorizontal: -20,
  },
  featuredScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  clusterSection: {
    marginBottom: 20,
  },
  clusterHeaderText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginLeft: 20,
    marginBottom: 8,
  },
  clusterScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  clusterCardWrap: {
    // 300px on iPhone-13-class+ devices to match the featured carousel,
    // but on narrower devices (iPhone SE @ 320pt) clamp so we keep a
    // visible peek of the next card (~60pt) — otherwise the horizontal
    // scroll affordance disappears.
    width: Math.min(300, Dimensions.get('window').width - 60),
  },
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 24,
    marginBottom: 12,
  },
  cardWrap: {
    marginBottom: 14,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: '#78695C', textAlign: 'center', marginBottom: 20 },
  emptySubText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: '#A09385', textAlign: 'center', lineHeight: 21, marginTop: -8, marginBottom: 20, maxWidth: 300 },
  emptyButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  emptyButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },
  errorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: '#2C1810', marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: '#78695C', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  retryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },

  profilePromptOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePromptCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    marginHorizontal: 32,
    alignItems: 'center',
  },
  profilePromptLogo: {
    width: 72,
    height: 72,
    marginBottom: 14,
  },
  profilePromptTitle: {
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sansBold,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 10,
  },
  profilePromptBody: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sans,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  profilePromptPrimaryBtn: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  profilePromptPrimaryBtnText: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansBold,
    color: Colors.white,
  },
  profilePromptLaterBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  profilePromptLaterText: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansMedium,
    color: Colors.textMedium,
  },
});

export function afterglowStyles(fonts: AfterglowFontFamilies, width: number) {
  const label = { ...AfterglowType.section, fontFamily: fonts.medium, color: AfterglowColors.muted };
  const body = { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const section = { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textTransform: 'none' as const, letterSpacing: -0.2 };
  const action = { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: AfterglowColors.clay };
  const actionText = { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white };
  return StyleSheet.create({
    container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
    header: { ...baseStyles.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
    screenTitle: { ...AfterglowType.screenTitle, fontFamily: fonts.display, color: AfterglowColors.ink },
    filterRow: { ...baseStyles.filterRow, justifyContent: 'flex-start', paddingHorizontal: 16, paddingVertical: 0, marginTop: 0, marginBottom: 14 },
    filterPill: { ...baseStyles.filterPill, height: undefined, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 22, borderWidth: 0, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
    filterPillActive: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    filterPillText: { ...label, includeFontPadding: false },
    filterPillTextActive: { color: AfterglowColors.white },
    radiusRow: { ...baseStyles.radiusRow, marginTop: 0 },
    radiusPill: { ...baseStyles.radiusPill, height: undefined, minHeight: 44, paddingVertical: 10, borderRadius: 22, borderWidth: 0, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
    radiusPillActive: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    radiusPillText: { ...label },
    radiusPillTextActive: { color: AfterglowColors.white },
    nearMeNotice: { ...baseStyles.nearMeNotice, minHeight: 44, borderRadius: 6, backgroundColor: AfterglowColors.white },
    nearMeNoticeText: body,
    listContent: { ...baseStyles.listContent, paddingHorizontal: 16, paddingBottom: 32 },
    sectionHeader: { ...baseStyles.sectionHeader, ...section, marginTop: 20, marginBottom: 12 },
    featuredHeaderText: section,
    clusterHeaderText: { ...baseStyles.clusterHeaderText, ...label, textTransform: 'none', letterSpacing: 0, marginLeft: 16 },
    clusterSection: { ...baseStyles.clusterSection, marginHorizontal: -16 },
    clusterScrollContent: { ...baseStyles.clusterScrollContent, paddingHorizontal: 16 },
    clusterCardWrap: { width: Math.min(340, width - 48) },
    featuredScroll: { marginHorizontal: -16 },
    featuredScrollContent: { ...baseStyles.featuredScrollContent, paddingHorizontal: 16 },
    cardWrap: { marginBottom: 12 },
    centered: { ...baseStyles.centered, paddingHorizontal: 20, gap: 8 },
    emptyState: { ...baseStyles.emptyState, paddingHorizontal: 12, paddingVertical: 32, gap: 12 },
    emptyText: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center', marginBottom: 0 },
    emptySubText: { ...body, textAlign: 'center', marginBottom: 8, maxWidth: 300 },
    emptyButton: action,
    emptyButtonText: actionText,
    errorTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center', marginBottom: 8 },
    errorMessage: { ...body, textAlign: 'center', marginBottom: 16 },
    retryButton: action,
    retryButtonText: actionText,
    feedback: { ...baseStyles.feedback, backgroundColor: AfterglowColors.white, marginHorizontal: 16, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
    feedbackText: { ...baseStyles.feedbackText, ...body },
    feedbackActionText: { ...actionText, color: AfterglowColors.clay },
  });
}
