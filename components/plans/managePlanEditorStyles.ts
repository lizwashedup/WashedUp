import { Dimensions, StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { detailAppearance } from './planDetailAppearance';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const legacyManagePlacesStyles = {
  container: { flex: 0 },
  textInputContainer: { backgroundColor: 'transparent' },
  textInput: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    height: 46,
    marginBottom: 0,
  },
  listView: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: Colors.white },
  separator: { height: 1, backgroundColor: Colors.inputBg, marginHorizontal: 14 },
  description: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  poweredContainer: { display: 'none' as const },
};

export const legacyManageStyles = StyleSheet.create({
  footer: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12, gap: 12 },
  recovery: { marginTop: 0 },
  editError: { color: Colors.errorRed, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, marginTop: 12 },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  closeX: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.textLight,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  creatorMessageInput: {
    minHeight: 50,
    textAlignVertical: 'top',
  },
  // Plan photo — same values as PlanComposerV2's photoRow/photoAdd/etc.
  photoRow: { marginTop: 0 },
  photoAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  photoAddText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  photoThumbWrap: { width: 96, height: 60, borderRadius: 12, overflow: 'hidden' },
  photoThumb: { width: '100%', height: '100%' },
  photoThumbOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark40 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.overlayDark60,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 4,
  },
  descLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    marginBottom: 6,
  },
  charCounter: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
  },
  charCounterWarn: {
    color: Colors.errorBrand,
    fontFamily: Fonts.sansSemibold,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 20,
  },
  pillSelected: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  pillTextSelected: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    borderRadius: 14,
    alignItems: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.parchment,
    borderWidth: 1,
    borderColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperBtnText: { fontFamily: Fonts.sans, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  stepperValue: { flex: 1, alignItems: 'center' },
  stepperValueText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayLG, color: Colors.terracotta },
  stepperValueSub: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginTop: -2 },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  // muted, never red (C13)
  cancelBtnText: { color: Colors.textMedium, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD },
  duplicateBtn: { alignItems: 'center', paddingVertical: 12 },
  duplicateBtnText: { color: Colors.terracotta, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD },
  featuredSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  featuredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  featuredTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    justifyContent: 'center',
  },
  featuredTypePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  featuredTypePillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  // Date / time editor in the manage modal
  dateTimeRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  dateTimeBtn: {
    flex: 1,
    justifyContent: 'center',
  },
  dateTimeBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  // Date / time picker overlays (inside the manage modal so they stack
  // above the form sheet without spawning a nested RN Modal).
  pickerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.overlayDark40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 24,
  },
  pickerSheet: {
    width: '88%',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  directTimeInput: {
    width: 55,
    minHeight: 50,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  directPeriod: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
  },
  directMinutes: { flexDirection: 'row', gap: 8, marginTop: 14 },
  directTimeError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 10 },
  pickerCol: {
    flex: 1,
  },
  pickerColSm: {
    flex: 0.7,
  },
  pickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickerItemSelected: {
    backgroundColor: Colors.terracotta,
  },
  pickerItemText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  pickerItemTextSel: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
  },
  pickerDoneBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  pickerDoneBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  capacitySection: {
    marginTop: 12,
    alignItems: 'center',
  },
  capacityValue: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    marginBottom: 8,
  },
});

export function manageAppearance<T extends Record<string, any>>(base: T, fonts: AfterglowFontFamilies): T {
  const result = detailAppearance(base, fonts) as any;
  Object.assign(result.sheet, { backgroundColor: AfterglowColors.paper, paddingHorizontal: 20, paddingTop: 12, maxHeight: '92%' });
  Object.assign(result.title, { ...AfterglowType.identity, fontFamily: fonts.semibold });
  Object.assign(result.label, { textTransform: 'none', letterSpacing: 0, fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: AfterglowColors.ink });
  for (const key of ['input', 'photoAdd']) Object.assign(result[key], { backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderRadius: 6, minHeight: 48 });
  Object.assign(result.saveBtn, { marginTop: 0, minHeight: 52 });
  Object.assign(result.photoRow, { gap: 10 });
  for (const key of ['pill', 'genderPill', 'featuredTypePill']) Object.assign(result[key], { borderRadius: 6, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: AfterglowColors.line });
  Object.assign(result.featuredTypePillText, { fontSize: FontSizes.bodySM });
  Object.assign(result.hint, { color: AfterglowColors.muted });
  Object.assign(result.photoRemove, { width: 44, height: 44, top: 0, right: 0, borderRadius: 6 });
  return result;
}
