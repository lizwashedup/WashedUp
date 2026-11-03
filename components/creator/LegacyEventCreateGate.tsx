import React, { useCallback, useMemo, useRef } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { ScaledText as Text } from '../ScaledText';
import { PageAction, PageFrame, pageStyles } from './pages/PageFrame';
import Colors from '../../constants/Colors';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { resolveLegacyEventCreate, type LegacyEventCreateContext } from '../../lib/legacyEventCreate';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { MANAGEMENT_HOME } from '../../lib/managementNavigation';

export function LegacyEventCreateGate({ workspace, communityId, children }: {
  workspace: unknown; communityId?: unknown;
  children: (context: LegacyEventCreateContext, scope: CreatorPageScope) => React.ReactNode;
}) {
  const { scope, account } = useCreatorPageScope('new-event:' + workspace + ':' + communityId);
  const identity = account.viewerId + ':' + account.epoch + ':' + workspace + ':' + communityId;
  const read = useCallback((owned: CreatorPageScope) => resolveLegacyEventCreate(workspace, communityId, owned), [workspace, communityId]);
  const result = useCreatorPageRead(scope, read);
  // Retain the unsaved form over a normal blur/refocus; writes wait for fresh access.
  const confirmed = useRef<{ identity: string; context: LegacyEventCreateContext } | undefined>(undefined);
  if (result.data && !result.error && !result.loading && scope?.isCurrent()) confirmed.current = { identity, context: result.data };
  const context = confirmed.current?.identity === identity ? confirmed.current.context : undefined;
  const ready = !!result.data && !result.error && !result.loading && !account.isLoading && !account.error;
  const latest = useRef({ identity, ready }); latest.current = { identity, ready };
  const owned = useMemo<CreatorPageScope | null>(() => scope ? { userId: scope.userId,
    isCurrent: () => scope.isCurrent() && latest.current.identity === identity && latest.current.ready } : null, [scope, identity]);
  if (context && owned) return <View key={identity} style={{ flex: 1 }}>
    {(result.error || account.error) && <View style={{ padding: 16, backgroundColor: Colors.cardBg }}>
      <Text accessibilityRole="alert" style={pageStyles.small}>Your draft is still here. Check your access before saving.</Text>
      <PageAction title="Check access" compact singleLine onPress={() => { void (account.error ? account.retry() : result.refresh()).catch(() => undefined); }} />
    </View>}
    {children(context, owned)}
  </View>;
  return <PageFrame title="Create an event">
    {result.loading || account.isLoading ? <ActivityIndicator accessibilityLabel="Checking event creation access" color={Colors.terracotta} /> : <>
      <Text accessibilityRole="alert" style={pageStyles.body}>{result.error ?? 'Check your account to create this event.'}</Text>
      <PageAction title="Try again" singleLine onPress={() => { void (account.error ? account.retry() : result.refresh()).catch(() => undefined); }} />
      <PageAction title="You manage" quiet singleLine onPress={() => router.dismissTo(MANAGEMENT_HOME)} />
    </>}
  </PageFrame>;
}
