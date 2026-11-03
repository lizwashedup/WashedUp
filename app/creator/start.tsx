import React, { useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import Colors from '../../constants/Colors';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { PageAction, PageFrame } from '../../components/creator/pages/PageFrame';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import { creationDestinations, loadCreationEntry, type SceneCreationKind } from '../../lib/creationEntry';
import { setWorkspace } from '../../lib/workspaceContext';
import { setSelectedCommunityId } from '../../lib/selectedCommunity';

export default function CreationStartRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return kind === 'event' || kind === 'community' ? <CreationStartScreen key={kind} kind={kind} /> : <Redirect href="/(tabs)/plans" />;
}

export function CreationStartScreen({ kind }: { kind: SceneCreationKind }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { scope, account } = useCreatorPageScope(`create-${kind}`);
  const { data, loading, error, refresh } = useCreatorPageRead(scope, loadCreationEntry);
  const navigation = useRef<object | null>(null);
  const ready = !!scope?.isCurrent() && !account.isLoading && !account.error && !loading && !error && !!data;
  const latest = useRef({ scope, ready, data });
  latest.current = { scope, ready, data };
  const destinations = data ? creationDestinations(kind, data.access) : [];
  const grant = data?.grants.find(item => item.track === (kind === 'community' ? 'community_leader' : 'event_host'));
  const pending = grant?.status === 'applied' || grant?.status === 'in_review';
  const canApply = !grant || ['withdrawn', 'declined', 'needs_more_info'].includes(grant.status);
  const go = (route: string, prepare?: () => void) => {
    if (!ready || !scope?.isCurrent() || !latest.current.ready || latest.current.scope !== scope || latest.current.data !== data || navigation.current === scope) return;
    navigation.current = scope;
    prepare?.();
    router.push(route as never);
  };
  const heading = kind === 'event' ? 'Create an event' : 'Start a community';
  const copy = (text: string) => <Text style={[styles.body, { fontFamily: fonts.regular }]}>{text}</Text>;
  const problem = account.error || error;

  return <PageFrame title={heading}>
    <Text accessibilityRole="header" style={[styles.title, { fontFamily: fonts.display }]}>{heading}</Text>
    {copy(kind === 'event' ? 'Organize a gathering with RSVPs or tickets.' : 'Bring people together around a shared interest and keep meeting up.')}
    {(account.isLoading || loading) && <ActivityIndicator accessibilityLabel="Checking creation access" color={Colors.terracotta} />}
    {problem && <View style={styles.card}>
      <Text accessibilityRole="alert" style={[styles.body, { fontFamily: fonts.regular }]}>Couldn’t load your creator access. Try again to continue.</Text>
      <PageAction compact quiet title="Try again" onPress={() => void (account.error ? account.retry() : refresh()).catch(() => undefined)} />
    </View>}
    {!account.isLoading && !account.error && account.viewerId === null && copy('Sign in to create something on WashedUp.')}
    {ready && <>
      {kind === 'event' && destinations.length > 0 && <Text style={[styles.label, { fontFamily: fonts.medium }]}>Created by</Text>}
      {destinations.map(destination => <View key={destination.id} style={styles.card}>
        <PageAction compact disclosure title={destination.title} onPress={() => go(destination.route, () => {
          setWorkspace(destination.workspace);
          setSelectedCommunityId(destination.communityId ?? null);
        })} />
        {copy(destination.description)}
      </View>)}
      {CREATOR_PAGES_ENABLED ? <View style={styles.card}>
        {copy(kind === 'event' ? 'Choose another community or organization, or set up your public creator identity.' : 'Continue a community draft or start setting up your new community.')}
        <PageAction compact primary singleLine title={kind === 'community' ? 'Continue setup' : 'Choose creator'} onPress={() => go('/creator/pages?create=' + kind)} />
      </View> : <>
        {canApply && <View style={styles.card}>
          {copy(kind === 'event'
            ? 'Creating events requires creator approval. Apply with your own public name or an organization. You don’t need to start a community.'
            : 'New community creators apply before setting up a public community and its group conversations.')}
          {copy('We’ll review new applications when the refreshed Scene is ready.')}
          <PageAction compact primary singleLine title={grant?.status === 'needs_more_info' ? 'Update application' : 'Apply'}
            onPress={() => go(kind === 'event' ? '/creator/apply-events' : '/creator/apply-community')} />
        </View>}
        {pending && <View style={styles.card}>
          {copy('Your application has been received. You can check its status without starting again.')}
          <PageAction compact quiet title="View application" onPress={() => go('/creator/apply')} />
        </View>}
        {grant?.status === 'revoked' && <View style={styles.card}>
          {copy('This creator application is closed. Open its status for more information.')}
          <PageAction compact quiet title="View application" onPress={() => go('/creator/apply')} />
        </View>}
        {kind === 'event' && destinations.length === 0 && data.access.hasLeaderGrant && <View style={styles.card}>
          {copy('Your community creator access is approved. Set up your community before creating its first event.')}
          <PageAction compact primary singleLine title="Set up community" onPress={() => go('/creator/setup-community', () => setWorkspace('community'))} />
        </View>}
      </>}
    </>}
  </PageFrame>;
}

const styles = StyleSheet.create({
  title: { fontSize: FontSizes.displayLG, lineHeight: LineHeights.displayLG, color: Colors.darkWarm, marginBottom: 12 },
  body: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  label: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm, marginTop: 24 },
  card: { backgroundColor: Colors.cardBg, borderColor: Colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12, marginTop: 16 },
});
