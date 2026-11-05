import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CircleAlert, RotateCw, Settings } from 'lucide-react-native';
import { ScaledText as Text } from '../ScaledText';
import { router } from 'expo-router';
import { SceneDetailColors as C } from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { type CreatorPageScope } from '../../lib/creatorPageReview';
import { resolveCommunityManageEntry } from '../../lib/communityManageEntry';
import { setSelectedCommunityId } from '../../lib/selectedCommunity';
import { setWorkspace } from '../../lib/workspaceContext';

export function CommunityManageLink({ communityId, iconOnly = false }: { communityId: string; iconOnly?: boolean }) {
  const { scope, account } = useCreatorPageScope(`manage-community:${communityId}`);
  const read = useCallback((owned: CreatorPageScope) => resolveCommunityManageEntry(communityId, owned, CREATOR_PAGES_ENABLED), [communityId]);
  const entry = useCreatorPageRead(scope, read);
  const lock = useRef<CreatorPageScope | null>(null);
  const [opening, setOpening] = useState<CreatorPageScope | null>(null);
  const [notice, setNotice] = useState<{ scope: CreatorPageScope; message: string }>();
  if (!scope || account.isLoading || account.error || !scope.isCurrent()) return null;
  const message = notice?.scope === scope ? notice.message : undefined;
  const busy = opening === scope || entry.loading;
  async function open() {
    if (!scope?.isCurrent() || lock.current === scope || busy) return;
    const owned = scope; lock.current = owned; setOpening(owned); setNotice(undefined);
    try {
      const fresh = await entry.refresh();
      if (!owned.isCurrent()) return;
      if (!fresh) { setNotice({ scope: owned, message: 'Your creator access has changed.' }); return; }
      if (fresh.kind === 'legacy') { setWorkspace('community'); setSelectedCommunityId(fresh.communityId); }
      router.push(fresh.route as never);
    } catch { /* The account-owned read supplies recovery below. */ }
    finally { if (lock.current === owned) lock.current = null; if (owned.isCurrent()) setOpening(null); }
  }
  if (entry.error) return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="Retry creator tools"
    accessibilityHint="Creator tools couldn’t be checked." style={({ pressed }) => [s.action, iconOnly && s.iconAction, pressed && s.pressed]} disabled={busy}
    onPress={() => { void entry.refresh().catch(() => undefined); }}>{iconOnly ? <RotateCw size={20} color={C.text} /> : <Text numberOfLines={1} style={s.text}>Retry tools</Text>}</Pressable>;
  if (message) return iconOnly ? <View accessible accessibilityLabel={message} accessibilityLiveRegion="polite" style={s.iconAction}>
    <CircleAlert size={20} color={C.supporting} />
  </View> : <Text accessibilityLabel={message} accessibilityLiveRegion="polite" style={s.copy}>Access changed</Text>;
  if (!entry.data) return null;
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="Manage community" accessibilityState={{ disabled: busy, busy }}
    accessibilityHint="Open this community’s settings and management tools."
    disabled={busy} onPress={() => { void open(); }} style={({ pressed }) => [s.action, iconOnly && s.iconAction, pressed && s.pressed]}>
    {iconOnly ? busy ? <ActivityIndicator accessibilityLabel="Checking community access" color={C.text} /> : <Settings size={20} color={C.text} />
      : <Text numberOfLines={1} style={s.text}>{busy ? 'Checking…' : 'Manage'}</Text>}
  </Pressable>;
}
const s = StyleSheet.create({
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  iconAction: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  text: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: C.text, textDecorationLine: 'underline' },
  copy: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: C.supporting },
});
