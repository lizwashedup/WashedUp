import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Pencil } from 'lucide-react-native';
import { ScaledText as Text } from '../ScaledText';
import { PageAction } from '../creator/pages/PageFrame';
import Colors from '../../constants/Colors';
import { FontSizes } from '../../constants/Typography';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { type CreatorPageScope } from '../../lib/creatorPageReview';
import { resolveCommunityCreatorActions, type CommunityCreatorAction } from '../../lib/communityManageEntry';
import { setWorkspace } from '../../lib/workspaceContext';
import { setSelectedCommunityId } from '../../lib/selectedCommunity';
import { requestWithDeadline } from '../../lib/requestWithDeadline';

/** Shortcuts are owned by this visit. Recheck before selecting any creator identity. */
export function CommunityCreatorActions({ communityId }: { communityId: string }) {
  const { scope, account } = useCreatorPageScope(`community-actions:${communityId}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const read = useCallback((owned: CreatorPageScope) => requestWithDeadline(resolveCommunityCreatorActions(communityId, owned, CREATOR_PAGES_ENABLED), 12_000), [communityId]);
  const entry = useCreatorPageRead(scope, read);
  const lock = useRef<CreatorPageScope | null>(null);
  const [opening, setOpening] = useState<{ scope: CreatorPageScope; key: string }>();
  const [notice, setNotice] = useState<{ scope: CreatorPageScope; message: string }>();
  const busy = opening?.scope === scope || entry.loading;
  async function open(key: CommunityCreatorAction['key']) {
    if (!scope?.isCurrent() || busy || lock.current === scope) return;
    const owned = scope; lock.current = owned; setOpening({ scope: owned, key }); setNotice(undefined);
    try {
      const fresh = await entry.refresh();
      if (!owned.isCurrent()) return;
      const action = fresh?.find(item => item.key === key);
      if (!action) { setNotice({ scope: owned, message: 'Your access or this community’s status has changed. Check the available actions below.' }); return; }
      if (action.legacyCommunityId) { setWorkspace('community'); setSelectedCommunityId(action.legacyCommunityId); }
      router.push(action.route as never);
    } catch { /* The owned read displays recovery. */ }
    finally { if (lock.current === owned) lock.current = null; if (owned.isCurrent()) setOpening(undefined); }
  }
  if (!scope?.isCurrent() || account.isLoading || account.error) return null;
  if (entry.error) return <View style={s.container}><Text style={[s.copy, { fontFamily: fonts.regular }]}>Couldn’t check your community actions.</Text>
    <PageAction quiet compact title="Try again" disabled={busy} onPress={() => void entry.refresh().catch(() => undefined)} /></View>;
  const message = notice?.scope === scope ? notice.message : undefined;
  if (!entry.data?.length && !message) return null;
  return <View style={s.container}>
    {message && <Text accessibilityRole="alert" style={[s.copy, { fontFamily: fonts.regular }]}>{message}</Text>}
    {entry.data?.map(action => <PageAction key={action.key} singleLine primary={action.key !== 'edit'} quiet={action.key === 'edit'}
      title={opening?.scope === scope && opening.key === action.key ? 'Checking…' : action.title} accessibilityLabel={action.title} disabled={busy}
      leadingIcon={action.key === 'event' ? <Plus size={18} color={Colors.white} /> : action.key === 'edit' ? <Pencil size={16} color={Colors.terracotta} /> : undefined}
      onPress={() => void open(action.key)} />)}
  </View>;
}
const s = StyleSheet.create({ container: { paddingHorizontal: 20, paddingTop: 12, gap: 4 }, copy: { color: Colors.textMedium, fontSize: FontSizes.bodyMD } });
