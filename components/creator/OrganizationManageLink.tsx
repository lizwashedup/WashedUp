import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { PageAction, pageStyles } from './pages/PageFrame';
import { ScaledText as Text } from '../ScaledText';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { getCreatorAccess } from '../../lib/creatorMode';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { prepareCreatorSpace } from '../../lib/creatorManagement';
import type { CreatorPageScope } from '../../lib/creatorPageReview';

export function OrganizationManageLink({ organizationId }: { organizationId: string }) {
  const { scope, account } = useCreatorPageScope('manage-organization:' + organizationId);
  const lock = useRef<CreatorPageScope | null>(null);
  const [state, setState] = useState<{ scope: CreatorPageScope; busy: boolean; error?: string }>();
  if (!scope || scope.userId !== organizationId || account.error || account.isLoading) return null;
  const busy = state?.scope === scope && state.busy;
  const open = async () => {
    if (!scope.isCurrent() || lock.current === scope) return;
    const owned = scope; lock.current = owned; setState({ scope: owned, busy: true });
    try {
      const access = await requestWithDeadline(getCreatorAccess(owned.userId), 12_000);
      if (!owned.isCurrent()) return;
      if (!access.hasEventHostGrant) throw Error('Your creator access has changed. Check your status in Yours.');
      const route = '/(tabs)/friends/manage/(tools)/organizer-home';
      prepareCreatorSpace({ id: organizationId, kind: 'organization', name: 'Your organization', route,
        legacy: { workspace: 'organization', status: 'approved' } }, owned);
      router.push(route);
    } catch (error) {
      if (owned.isCurrent()) setState({ scope: owned, busy: false, error: error instanceof Error ? error.message : 'Couldn’t open management. Try again.' });
    } finally {
      if (lock.current === owned) lock.current = null;
      if (owned.isCurrent()) setState(old => old?.scope === owned ? { ...old, busy: false } : old);
    }
  };
  return <View><PageAction title={busy ? 'Checking…' : 'Manage'} compact singleLine disabled={!!busy} onPress={() => { void open(); }} />
    {state?.scope === scope && state.error && <Text accessibilityRole="alert" style={pageStyles.small}>{state.error}</Text>}</View>;
}
