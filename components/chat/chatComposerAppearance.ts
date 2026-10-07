import { Platform, StyleSheet } from 'react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

/** Appearance adapter for the existing Plan/Circle/DM composer. Keep native
 * keyboard offsets, measured dock height and recording gestures in ChatThread. */
export function createChatComposerAppearance(fonts: AfterglowFontFamilies) {
  const actionSize = Platform.OS === 'android' ? 48 : 44;
  return StyleSheet.create({
    tray: { backgroundColor: Colors.paper, borderColor: Colors.subtleLine },
    bar: { backgroundColor: Colors.paper, borderTopColor: Colors.subtleLine, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
    utility: { width: actionSize, height: actionSize, marginBottom: 0, flexShrink: 0 },
    input: { ...AfterglowType.message, fontFamily: fonts.regular, color: Colors.ink, backgroundColor: Colors.white, minWidth: 0, minHeight: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.line },
    morph: { width: actionSize, height: actionSize, marginBottom: 0, flexShrink: 0, marginLeft: 4 },
    layer: { borderRadius: actionSize / 2 },
    send: { backgroundColor: Colors.clay },
    metadata: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Colors.muted },
    contextName: { ...AfterglowType.caption, fontFamily: fonts.semibold, color: Colors.clay },
    contextBody: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Colors.muted },
  });
}
