import { StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export const legacyStyles = StyleSheet.create({
  headerAction: {}, clearEndAction: {}, postActions: {}, modalHeader: {},
  screen: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  cancel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  headerTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  postInline: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  postInlineOff: { color: Colors.tertiary },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  fieldError: { color: Colors.errorBrand, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, lineHeight: 20, marginTop: 8 },
  invalidInput: { borderColor: Colors.errorBrand },
  section: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  label: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.4,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 10,
  },
  subLabel: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.2,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 8, marginTop: 4,
  },
  labelOptional: {
    fontFamily: Fonts.sansMedium, fontSize: 13, letterSpacing: 0,
    textTransform: 'none', color: Colors.secondary,
  },
  endTimeRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 16,
  },
  clearEndText: {
    fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary,
    marginBottom: 8, marginTop: 4,
  },

  // Photo
  photoRow: { marginTop: 12 },
  photoAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  photoAddText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary },
  photoThumbWrap: { width: 96, height: 60, borderRadius: 12, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoThumbOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark40 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark60,
  },

  // Message (bounded field; the editorial underline is reserved for WHAT only)
  messageInput: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm,
    minHeight: 64, lineHeight: 22, textAlignVertical: 'top',
  },

  // When
  quickRow: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  quickChip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  quickChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  quickChipText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary },
  quickChipTextOn: { color: Colors.white },
  timeRowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  timeLabel: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary, letterSpacing: 0.4 },
  timePill: { backgroundColor: Colors.accentSubtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  timePillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  timeChange: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary, marginLeft: 'auto' },

  // How many
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  stepperBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.borderWarm, backgroundColor: Colors.white,
  },
  stepperBtnOff: { opacity: 0.4 },
  stepperBtnText: { fontFamily: Fonts.sans, fontSize: 22, color: Colors.darkWarm, lineHeight: 26 },
  stepperValue: { alignItems: 'center', minWidth: 80 },
  stepperValueNum: { fontFamily: Fonts.sansBold, fontSize: 22, color: Colors.darkWarm },
  stepperValueSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  stepperHint: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, textAlign: 'center', marginTop: 8 },

  // Audience row
  audienceRow: { marginTop: 16 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  smallPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  smallPillOn: { backgroundColor: Colors.accentSubtle, borderColor: Colors.terracotta },
  smallPillText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary },
  smallPillTextOn: { color: Colors.terracotta },

  // Optional extras (quiet secondary footer section; no collapsible)
  secondarySection: { borderBottomWidth: 0, paddingTop: 16, paddingBottom: 28 },
  secondaryHeader: {
    fontFamily: Fonts.sansSemibold, fontSize: 12, letterSpacing: 1.2,
    textTransform: 'uppercase', color: Colors.tertiary, marginBottom: 14,
  },
  mutedLabel: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary, marginBottom: 8 },
  textField: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14,
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  descLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10,
  },
  charCounter: {
    fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary,
  },
  charCounterWarn: { color: Colors.errorBrand, fontFamily: Fonts.sansSemibold },
  selectField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14,
  },
  selectFieldText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  selectFieldPlaceholder: { color: Colors.inkSoft },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  toggleTextWrap: { flex: 1, paddingRight: 16 },
  toggleTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  toggleSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: Colors.borderWarm, padding: 3, justifyContent: 'center' },
  switchTrackOn: { backgroundColor: Colors.terracotta },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.white },
  switchThumbOn: { alignSelf: 'flex-end' },

  // Post bar
  postBar: {
    backgroundColor: Colors.cream, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 20, paddingTop: 12,
  },
  recoveryNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  recoveryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  recoveryText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18, color: Colors.quoteText },
  summaryCard: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  summaryTitle: { fontFamily: Fonts.display, fontSize: 16, color: Colors.darkWarm },
  summaryMeta: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  postBtn: {
    backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: Colors.terracotta, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  postBtnOff: { opacity: 0.45 },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white, letterSpacing: 0.2 },
  draftLinkWrap: { alignItems: 'center', marginTop: 10 },
  draftLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  draftLinkOff: { opacity: 0.45 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: Colors.overlayDark40, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18 },
  modalTitle: { fontFamily: Fonts.display, fontSize: 22, color: Colors.darkWarm, marginBottom: 16 },
  modalConfirm: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  modalConfirmText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  timeColumns: { flexDirection: 'row', gap: 12, height: 180 },
  timeCol: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  timeOpt: { paddingVertical: 10, alignItems: 'center' },
  timeOptOn: { backgroundColor: Colors.accentSubtle },
  timeOptText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  timeOptTextOn: { color: Colors.terracotta, fontFamily: Fonts.sansBold },
  neighborhoodList: { maxHeight: 340 },
  neighborhoodOpt: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  neighborhoodOptText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  neighborhoodOptTextOn: { color: Colors.terracotta, fontFamily: Fonts.sansBold },
});

export function composerAppearance(fonts: AfterglowFontFamilies) {
  const body = { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const label = { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink, letterSpacing: 0, textTransform: 'none' as const };
  const action = { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.clay };
  const input = { ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1, borderRadius: 4 };
  const control = { minHeight: 44, borderRadius: 4, justifyContent: 'center' as const };
  return StyleSheet.create({
    fieldError: { ...legacyStyles.fieldError, fontFamily: fonts.medium },
    screen: { ...legacyStyles.screen, backgroundColor: AfterglowColors.paper },
    header: { ...legacyStyles.header, paddingVertical: 4, borderBottomColor: AfterglowColors.line },
    headerAction: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    cancel: { ...body, color: AfterglowColors.ink },
    headerTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    postInline: action,
    postInlineOff: { color: AfterglowColors.muted },
    section: { ...legacyStyles.section, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
    label: { ...label, marginBottom: 10 },
    subLabel: { ...label, marginBottom: 8, marginTop: 4 },
    labelOptional: body,
    clearEndAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    clearEndText: { ...body, color: AfterglowColors.clay },
    photoAdd: { ...legacyStyles.photoAdd, ...control, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    photoAddText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    photoThumbWrap: { ...legacyStyles.photoThumbWrap, width: 128, height: 80, borderRadius: 4 },
    photoRemove: { ...legacyStyles.photoRemove, width: 44, height: 44, top: 0, right: 0, borderRadius: 4 },
    messageInput: { ...legacyStyles.messageInput, ...input, minHeight: 84 },
    quickChip: { ...legacyStyles.quickChip, ...control, paddingHorizontal: 16, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    quickChipOn: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    quickChipText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    quickChipTextOn: { color: AfterglowColors.white },
    stepperBtn: { ...legacyStyles.stepperBtn, width: 44, height: 44, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    stepperBtnText: { ...AfterglowType.identity, fontFamily: fonts.regular, color: AfterglowColors.ink },
    stepperValueNum: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    stepperValueSub: { ...body, marginTop: 2 },
    stepperHint: { ...body, textAlign: 'center', marginTop: 4 },
    smallPill: { ...legacyStyles.smallPill, ...control, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    smallPillOn: { backgroundColor: AfterglowColors.avatar, borderColor: AfterglowColors.clay },
    smallPillText: { ...body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    smallPillTextOn: { color: AfterglowColors.clay },
    secondaryHeader: { ...label, color: AfterglowColors.muted, marginBottom: 14 },
    mutedLabel: { ...body, marginBottom: 8 },
    textField: { ...legacyStyles.textField, ...input, minHeight: 48 },
    textArea: { ...legacyStyles.textArea, minHeight: 88 },
    charCounter: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
    charCounterWarn: { color: Colors.errorBrand, fontFamily: fonts.semibold },
    selectField: { ...legacyStyles.selectField, ...input, minHeight: 48 },
    selectFieldText: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink, flex: 1 },
    selectFieldPlaceholder: { color: AfterglowColors.muted },
    toggleRow: { ...legacyStyles.toggleRow, minHeight: 56 },
    toggleTitle: { ...label },
    toggleSub: { ...body, marginTop: 3 },
    switchTrack: { ...legacyStyles.switchTrack, backgroundColor: AfterglowColors.line },
    switchTrackOn: { backgroundColor: AfterglowColors.clay },
    postBar: { ...legacyStyles.postBar, backgroundColor: AfterglowColors.paper, borderTopColor: AfterglowColors.line },
    recoveryNudge: { ...legacyStyles.recoveryNudge, minHeight: 44, borderRadius: 4, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
    recoveryDot: { ...legacyStyles.recoveryDot, backgroundColor: AfterglowColors.clay },
    recoveryText: { ...body, flex: 1 },
    summaryCard: { paddingVertical: 2, marginBottom: 10 },
    summaryTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    summaryMeta: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
    postActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    postBtn: { ...legacyStyles.postBtn, flex: 1, minHeight: 48, paddingVertical: 12, borderRadius: 4, backgroundColor: AfterglowColors.clay, shadowOpacity: 0, elevation: 0 },
    postBtnText: { ...action, color: AfterglowColors.white },
    draftLinkWrap: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
    draftLink: action,
    modalSheet: { ...legacyStyles.modalSheet, backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
    modalTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, flex: 1 },
    neighborhoodOpt: { ...legacyStyles.neighborhoodOpt, minHeight: 48, borderBottomColor: AfterglowColors.subtleLine },
    neighborhoodOptText: { ...AfterglowType.title, fontFamily: fonts.regular, color: AfterglowColors.ink },
    neighborhoodOptTextOn: { color: AfterglowColors.clay, fontFamily: fonts.semibold },
  });
}
