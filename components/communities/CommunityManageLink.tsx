import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
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

export function CommunityManageLink({ communityId }: { communityId: string }) {
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
  if (entry.error) return <Pressable accessibilityRole="button" accessibilityLabel="Retry creator tools"
    accessibilityHint="Creator tools couldn’t be checked." style={s.action} disabled={busy}
    onPress={() => { void entry.refresh().catch(() => undefined); }}><Text numberOfLines={1} style={s.text}>Retry tools</Text></Pressable>;
  if (message) return <Text accessibilityLabel={message} accessibilityLiveRegion="polite" style={s.copy}>Access changed</Text>;
  if (!entry.data) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Manage community" accessibilityState={{ disabled: busy }}
    disabled={busy} onPress={() => { void open(); }} style={s.action}><Text numberOfLines={1} style={s.text}>{busy ? 'Checking…' : 'Manage'}</Text></Pressable>;
}
const s = StyleSheet.create({
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  text: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: C.text, textDecorationLine: 'underline' },
  copy: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: C.supporting },
});
