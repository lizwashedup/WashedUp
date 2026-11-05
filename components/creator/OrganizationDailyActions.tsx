import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { getCreatorAccess } from '../../lib/creatorMode';
import { prepareCreatorSpace } from '../../lib/creatorManagement';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { managementRoute } from '../../lib/managementNavigation';
import { PageAction, pageStyles } from './pages/PageFrame';
import { ScaledText } from '../ScaledText';

/** Daily organization destinations formerly hidden behind separate creator tabs. */
export function OrganizationDailyActions() {
  const { scope, account } = useCreatorPageScope('organization-daily-actions');
  const lock = useRef<CreatorPageScope | null>(null);
  const [status, setStatus] = useState<{ scope: CreatorPageScope; busy: boolean; error?: string }>();
  const busy = status?.scope === scope && status.busy;
  const open = async (screen: 'events' | 'menu') => {
    if (!scope?.isCurrent() || account.isLoading || account.error || lock.current === scope) return;
    const owned = scope; lock.current = owned; setStatus({ scope: owned, busy: true });
    try {
      const access = await requestWithDeadline(getCreatorAccess(owned.userId), 12_000);
      if (!owned.isCurrent()) return;
      if (!access.hasEventHostGrant) throw Error('Your access has changed. Return to Yours to see your current tools.');
      const route = managementRoute(screen);
      prepareCreatorSpace({ id: 'legacy-organizer-approval', name: 'Your organization', kind: 'organization', route,
        legacy: { workspace: 'organization', status: 'approved' } }, owned);
      router.push(route);
    } catch (error) {
      if (owned.isCurrent()) setStatus({ scope: owned, busy: false, error: error instanceof Error ? error.message : 'Couldn’t open these tools. Try again.' });
    } finally {
      if (lock.current === owned) lock.current = null;
      if (owned.isCurrent()) setStatus(old => old?.scope === owned ? { ...old, busy: false } : old);
    }
  };
  return <View>
    <View style={pageStyles.row}>
      <PageAction title="Events" disclosure disabled={!!busy} onPress={() => void open('events')} />
      <ScaledText style={pageStyles.small}>Create an event or continue a saved draft.</ScaledText>
    </View>
    <View style={pageStyles.row}>
      <PageAction title="Settings" disclosure disabled={!!busy} onPress={() => void open('menu')} />
      <ScaledText style={pageStyles.small}>Edit your organization, manage payouts and get help.</ScaledText>
    </View>
    {busy && <ScaledText accessibilityLiveRegion="polite" style={pageStyles.small}>Checking access…</ScaledText>}
    {status?.scope === scope && status.error && <ScaledText accessibilityRole="alert" style={pageStyles.small}>{status.error}</ScaledText>}
  </View>;
}
