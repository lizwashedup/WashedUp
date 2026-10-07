import ProfileButton from '../ProfileButton';
import { ChatSizedText } from './ChatSizedText';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

interface Props {
  title: string;
  subtitle?: string | null;
  location?: string | null;
  contextLabel: string;
  fonts: AfterglowFontFamilies;
  onBack: () => void;
  backLabel?: string;
  onViewContext?: () => void;
  actions?: React.ReactNode;
  wrapActionsOnNarrow?: boolean;
}

/** Compact identity/navigation only: callbacks preserve each room's routes.
 * Calendar, moderation, mute and measured menus remain owned by the caller. */
export function ChatContextHeader({ title, subtitle, location, contextLabel, fonts, onBack, backLabel = 'Back to Chats', onViewContext, actions, wrapActionsOnNarrow = false }: Props) {
  const [narrow, setNarrow] = useState(false);
  const stackedActions = narrow && wrapActionsOnNarrow && !!actions;
  const identityLabel = contextLabel.toLocaleLowerCase().endsWith(title.toLocaleLowerCase())
    ? contextLabel : `${contextLabel}: ${title}`;
  const identity = <>
    <View style={styles.titleRow}><ChatSizedText style={[styles.title, { fontFamily: fonts.semibold }]} numberOfLines={1}>{title}</ChatSizedText>{!!onViewContext && (stackedActions || !(subtitle || location)) && <ChevronRight size={12} color={Colors.muted} style={styles.disclosure}/>}</View>
    {!stackedActions && !!(subtitle || location) && <View style={styles.titleRow}><ChatSizedText style={[styles.subtitle, { fontFamily: fonts.regular, flexShrink: 1 }]} numberOfLines={1}>{[subtitle, location].filter(Boolean).join(' · ')}</ChatSizedText>{!!onViewContext && <ChevronRight size={12} color={Colors.muted} style={styles.disclosure}/>}</View>}
  </>;
  return <View style={styles.container} onLayout={({ nativeEvent }) => setNarrow(nativeEvent.layout.width < 360)}>
    <View style={styles.header}>
    <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} style={chatHeaderActionStyle}>
      <ChevronLeft size={22} color={Colors.ink} />
    </TouchableOpacity>
    {onViewContext ? <TouchableOpacity onPress={onViewContext} accessibilityRole="button"
      accessibilityLabel={identityLabel}
      accessibilityHint={[subtitle, location].filter(Boolean).join('. ')}
      style={styles.identity} activeOpacity={0.7}>
      {identity}
    </TouchableOpacity> : <View style={styles.identity} accessible accessibilityLabel={[title, subtitle, location].filter(Boolean).join('. ')}>{identity}</View>}
    {!!actions && !stackedActions && <View style={styles.actions}>{actions}</View>}
    <ProfileButton compact/>
    </View>
    {stackedActions && <View style={styles.utilityRow}>
      <ChatSizedText style={[styles.subtitle, styles.utilityContext, { fontFamily: fonts.regular }]} numberOfLines={2}>{[subtitle, location].filter(Boolean).join(' · ')}</ChatSizedText>
      <View style={styles.actions}>{actions}</View>
    </View>}
  </View>;
}

export const chatHeaderActionStyle = {
  width: 44, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const,
};
const styles = StyleSheet.create({
  container: { backgroundColor: Colors.paper, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.subtleLine },
  utilityRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 8, paddingBottom: 2 },
  utilityContext: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 6 },
  identity: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 4, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { ...AfterglowType.contextTitle, color: Colors.ink, flexShrink: 1 },
  disclosure: { flexShrink: 0 },
  subtitle: { ...AfterglowType.caption, color: Colors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
});
