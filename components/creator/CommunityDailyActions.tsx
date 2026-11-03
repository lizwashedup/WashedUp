import React, { useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ScaledText as Text } from '../ScaledText';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { getCreatorAccess, isAdminTierRole } from '../../lib/creatorMode';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { prepareCreatorSpace } from '../../lib/creatorManagement';
import type { CreatorPageScope } from '../../lib/creatorPageReview';

const actions = [
  { key: 'chat', title: 'Main chat', hint: 'Open your community’s conversation.' },
  { key: 'members', title: 'Members', hint: 'Review join requests and manage your members.' },
  { key: 'events', title: 'Events', hint: 'Manage events and saved drafts.' },
  { key: 'settings', title: 'Settings', hint: 'Edit your page, joining settings and updates.' },
] as const;

export function CommunityDailyActions({ communityId }: { communityId: string }) {
  const { scope, account } = useCreatorPageScope('community-actions:' + communityId);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const lock = useRef<CreatorPageScope | null>(null);
  const [state, setState] = useState<{ scope: CreatorPageScope; busy: boolean; message?: string }>();
  const busy = state?.scope === scope && state.busy;
  const open = async (key: typeof actions[number]['key']) => {
    if (!scope?.isCurrent() || account.error || account.isLoading || lock.current === scope) return;
    const owned = scope; lock.current = owned; setState({ scope: owned, busy: true });
    try {
      const access = await requestWithDeadline(getCreatorAccess(owned.userId), 12_000);
      if (!owned.isCurrent()) return;
      const community = access.ledCommunities.find(item => item.id === communityId);
      const allowed = community && (key === 'chat' || isAdminTierRole(community.role)
        || key === 'members' && community.role === 'member_care' || key === 'events' && community.role === 'events');
      if (!allowed) throw Error('Your access has changed. Return to Yours to see your current tools.');
      const route = key === 'chat' ? '/community-thread/' + communityId : key === 'settings' ? '/(tabs)/friends/manage/(tools)/community' : '/(tabs)/friends/manage/(tools)/' + key;
      prepareCreatorSpace({ id: communityId, name: community.name, kind: 'community', route,
        legacy: { workspace: 'community', communityId, status: community.status } }, owned);
      router.push(route as never);
    } catch (error) {
      if (owned.isCurrent()) setState({ scope: owned, busy: false, message: error instanceof Error ? error.message : 'Couldn’t open these tools. Try again.' });
    } finally {
      if (lock.current === owned) lock.current = null;
      if (owned.isCurrent()) setState(old => old?.scope === owned ? { ...old, busy: false } : old);
    }
  };
  return <View style={s.wrap}>
    {actions.map(action => <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.title}
      accessibilityHint={action.hint} accessibilityState={{ disabled: !!busy }} disabled={!!busy}
      onPress={() => { void open(action.key); }} style={s.row}>
      <View style={s.copy}><Text numberOfLines={1} adjustsFontSizeToFit style={[s.title, { fontFamily: fonts.medium }]}>{action.title}</Text>
        <Text style={[s.hint, { fontFamily: fonts.regular }]}>{action.hint}</Text></View>
      <ChevronRight size={18} color={Colors.textMedium} />
    </Pressable>)}
    {busy && <Text accessibilityLiveRegion="polite" style={[s.hint, { fontFamily: fonts.regular }]}>Checking access…</Text>}
    {state?.scope === scope && state.message && <Text accessibilityRole="alert" style={[s.hint, { fontFamily: fonts.regular }]}>{state.message}</Text>}
  </View>;
}
const s = StyleSheet.create({
  wrap: { marginBottom: 20, gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, backgroundColor: Colors.cardBg },
  copy: { flex: 1, minWidth: 0, gap: 4 }, title: { fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  hint: { fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.textMedium },
});
