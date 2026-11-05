import { StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

export function detailAppearance<T extends Record<string, any>>(base: T, fonts: AfterglowFontFamilies): T {
  const colorMap: Record<string, string> = {
    [Colors.parchment]: AfterglowColors.paper, [Colors.asphalt]: AfterglowColors.ink,
    [Colors.textLight]: AfterglowColors.muted,
    [Colors.terracotta]: AfterglowColors.clay, [Colors.cardBg]: AfterglowColors.white,
    [Colors.border]: AfterglowColors.subtleLine, [Colors.inputBg]: AfterglowColors.white,
  };
  const familyMap: Record<string, string> = { [Fonts.displayBold]: fonts.display, [Fonts.display]: fonts.regular,
    [Fonts.sans]: fonts.regular, [Fonts.sansMedium]: fonts.medium, [Fonts.sansSemibold]: fonts.semibold, [Fonts.sansBold]: fonts.semibold };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => {
    const style = { ...StyleSheet.flatten(value) } as any;
    for (const prop of ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor']) if (colorMap[style[prop]]) style[prop] = colorMap[style[prop]];
    if (familyMap[style.fontFamily]) style.fontFamily = familyMap[style.fontFamily];
    if (/Button$|Btn$/.test(key)) { style.minHeight = 48; style.borderRadius = 6; }
    if (['joinButton', 'openChatButton', 'managePlanButton', 'waitlistButton'].includes(key)) style.borderRadius = 14;
    if (key === 'headerIconButton') { style.width = 44; style.height = 44; style.backgroundColor = AfterglowColors.paper; style.borderWidth = 0; }
    if (key === 'youreGoingBadge') { style.backgroundColor = AfterglowColors.paper; style.minHeight = 48; style.borderRadius = 0; style.justifyContent = 'center'; }
    if (key === 'youreGoingText') style.color = AfterglowColors.muted;
    if (key === 'scrollContent') style.paddingBottom = 28;
    if (key === 'stickyBar') { style.position = 'relative'; style.bottom = undefined; style.left = undefined; style.right = undefined; style.borderTopColor = AfterglowColors.subtleLine; }
    if (key === 'title') { Object.assign(style, AfterglowType.identity); }
    if (key === 'sheet') { style.borderTopLeftRadius = 12; style.borderTopRightRadius = 12; }
    return [key, style];
  })) as T;
}

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
