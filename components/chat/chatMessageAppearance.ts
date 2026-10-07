import { StyleSheet } from 'react-native';
import LiveColors, { AfterglowColors } from '../../constants/Colors';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED, memberPresentationFonts } from '../../constants/MemberAppearance';
import { ChatType, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

/** Shared presentation for the staged chats. Message transport, gestures,
 * ordering, membership and reaction behavior remain with each room adapter. */
export function createChatMessageAppearance(fonts: AfterglowFontFamilies) {
  fonts = memberPresentationFonts(fonts);
  const Colors = MEMBER_REDESIGN_APPEARANCE_ENABLED ? AfterglowColors : {
    ...AfterglowColors, paper: LiveColors.parchment, ink: LiveColors.darkWarm,
    clay: LiveColors.terracotta, white: LiveColors.cardBg, muted: LiveColors.secondary,
    avatar: LiveColors.inputBg, subtleLine: LiveColors.border,
  };
  return StyleSheet.create({
    bubble: { borderRadius: 14, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 5, borderBottomRightRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.subtleLine, backgroundColor: Colors.white, paddingHorizontal: 11, paddingVertical: 7 },
    bubbleOwn: { borderBottomLeftRadius: 14, borderBottomRightRadius: 5, backgroundColor: Colors.clay, borderColor: Colors.clay },
    body: { ...ChatType.message, fontFamily: fonts.regular, color: Colors.ink },
    bodyOwn: { color: Colors.white },
    sender: { ...ChatType.sender, fontFamily: fonts.semibold, fontWeight: 'normal', color: Colors.clay },
    metadata: { ...ChatType.time, fontFamily: fonts.regular, color: Colors.muted },
    metadataOwn: { color: Colors.white },
    quote: { borderLeftColor: Colors.clay, paddingLeft: 8, borderRadius: 10, backgroundColor: Colors.paper },
    quoteOwn: { borderLeftColor: Colors.white, backgroundColor: Colors.clay },
    quoteName: { ...AfterglowType.caption, fontFamily: fonts.semibold, color: Colors.clay },
    quoteBody: { ...ChatType.quote, fontFamily: fonts.regular, color: Colors.muted },
    link: { fontFamily: fonts.medium, color: Colors.clay, textDecorationLine: 'underline' },
    linkOwn: { fontFamily: fonts.medium, color: Colors.white, textDecorationLine: 'underline' },
    mention: { fontFamily: fonts.semibold, color: Colors.clay },
    mentionOwn: { fontFamily: fonts.semibold, color: Colors.white },
    day: { ...AfterglowType.caption, fontFamily: fonts.medium, color: Colors.muted, backgroundColor: Colors.paper, borderRadius: 0 },
    avatar: { backgroundColor: Colors.avatar },
    avatarInitial: { ...AfterglowType.caption, fontFamily: fonts.medium, color: Colors.clay },
  });
}
