import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ScaledText as Text } from '../ScaledText';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { isAdminTierRole, type LedCommunity } from '../../lib/creatorMode';
import { MANAGEMENT_HOME, managementRoute } from '../../lib/managementNavigation';

/** Navigation only. Publishing remains an explicit action in community settings. */
export function CommunitySetupNotice({ community, onNavigate }: {
  community: LedCommunity | null;
  onNavigate: (route: string) => void;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  if (!community || community.status === 'active') return null;
  const archived = community.status === 'archived';
  const canFinish = !archived && isAdminTierRole(community.role);
  const action = archived ? 'You manage' : canFinish ? 'Continue setup' : null;
  return <View style={s.notice}>
    <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.medium }]}>
      {archived ? 'This community is archived' : 'Finish your community page'}
    </Text>
    <Text style={[s.body, { fontFamily: fonts.regular }]}>
      {archived ? 'New events aren’t available for this community. Choose an active community or organization to create one.'
        : canFinish ? 'Your community is still a draft. Finish and publish its page before creating an event.'
        : 'A community admin needs to finish and publish this page before you can create an event.'}
    </Text>
    {action && <Pressable accessibilityRole="button" accessibilityLabel={action} style={s.action}
      onPress={() => onNavigate(archived ? MANAGEMENT_HOME : managementRoute('community'))}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[s.actionText, { fontFamily: fonts.medium }]}>{action}</Text>
    </Pressable>}
  </View>;
}

const s = StyleSheet.create({
  notice: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg, gap: 10, marginBottom: 20 },
  heading: { fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Colors.asphalt },
  body: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.textMedium },
  action: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingVertical: 8 },
  actionText: { fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
