/** Community discovery and publication controls, scoped to the selected creator. */
import React, { useRef, useState } from 'react';
import { View, ActivityIndicator, Share } from 'react-native';
import { ScaledText as Text } from '../../components/ScaledText';
import { Redirect, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Colors from '../../constants/Colors';
import { PUBLIC_PAGE_CONTROL_ENABLED } from '../../constants/FeatureFlags';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { PageAction, PageFrame, pageStyles as s } from '../../components/creator/pages/PageFrame';
import { CommunityPublicationFeedback } from '../../components/creator/CommunityPublicationFeedback';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useCommunityPublication } from '../../hooks/useCommunityPublication';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { buildCommunityPublicLink, type LedCommunity } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';

export default function PublicPageControlScreen() {
  const access = useCreatorAccessRead(), focused = useIsFocused();
  const community = useLedCommunity(access.data);
  if (!PUBLIC_PAGE_CONTROL_ENABLED) return focused ? <Redirect href="/(tabs)/friends/manage" /> : null;
  if (access.isLoading || access.isError) return <PageFrame title="Visibility & link">
    {access.isLoading ? <ActivityIndicator accessibilityLabel="Loading visibility settings" color={Colors.terracotta} /> : <>
      <Text accessibilityRole="alert" style={s.body}>Couldn’t check your creator access.</Text>
      <PageAction title="Try again" singleLine onPress={() => void access.refetch()} />
    </>}
  </PageFrame>;
  if (!community || !['leader', 'co_leader'].includes(community.role)) return focused ? <Redirect href="/(tabs)/friends/manage" /> : null;
  return <VisibilitySettings key={community.id} community={community} />;
}

function VisibilitySettings({ community }: { community: LedCommunity }) {
  const router = useRouter();
  const publication = useCommunityPublication(community.id);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const body = [s.small, { fontFamily: fonts.regular }];
  const [alert, setAlert] = useState<{ scope: NonNullable<typeof publication.scope>; title: string; message: string; buttons: BrandedAlertButton[] }>();
  const [shareScope, setShareScope] = useState<typeof publication.scope>(null);
  const sharing = !!shareScope && shareScope === publication.scope;
  const shareLock = useRef(false);
  const state = publication.state;
  const active = state?.status === 'active';
  const archived = state?.status === 'archived';
  const ownAlert = alert?.scope === publication.scope ? alert : undefined;
  const share = async () => {
    const scope = publication.scope;
    if (!scope?.isCurrent() || !active || shareLock.current || !publication.ready) return;
    shareLock.current = true; setShareScope(scope);
    try { await Share.share({ message: buildCommunityPublicLink(community.handle) }); }
    catch { if (scope.isCurrent()) setAlert({ scope, title: 'Sharing didn’t open', message: 'Try sharing the link again when you’re ready.', buttons: [{ text: 'OK' }] }); }
    finally { shareLock.current = false; setShareScope(previous => previous === scope ? null : previous); }
  };
  const unpublish = () => {
    const scope = publication.scope;
    if (!scope?.isCurrent() || !publication.ready || !active) return;
    setAlert({ scope, title: 'Unpublish this page?',
      message: 'Your community will stop appearing in discovery and close to new requests. Existing members keep their membership and chats. You can publish it again from Settings.',
      buttons: [{ text: 'Not now', style: 'cancel' }, { text: 'Unpublish', style: 'destructive', onPress: () => { void publication.run('unpublish'); } }],
    });
  };
  return <PageFrame title="Visibility & link" onRefresh={publication.refresh} refreshing={publication.loading}>
    <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.display }]}>{community.name}</Text>
    <Text style={body}>Choose where people can find your community. Joining requirements still apply.</Text>
    <CommunityPublicationFeedback publication={publication} />
    {state && <>
      <View style={s.row}>
        <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.medium }]}>Page status</Text>
        <Text style={body}>{active ? 'Published' : archived ? 'Archived' : 'Draft'}</Text>
        <Text style={body}>{active ? 'Your page is published. Visibility and eligibility settings determine who can access it.'
          : archived ? 'Hidden from discovery and closed to new members. Existing members keep their chat and access.'
          : 'This page is not published. Finish setup and publish it from Community settings.'}</Text>
      </View>
      {!archived && <View style={[s.row, { gap: 12 }]}>
        <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.medium }]}>Discovery</Text>
        <Text style={body}>{active ? 'Choose whether eligible people can find this community while browsing WashedUp.'
          : 'Choose where your community will appear after you publish it.'}</Text>
        {!publication.discoveryAvailable && <Text style={body}>Discovery changes aren’t available yet. Your saved visibility stays the same.</Text>}
        <PageAction title={state.discoverable ? 'Show in discovery ✓' : 'Show in discovery'} singleLine
          primary={state.discoverable} disabled={!publication.ready || !publication.discoveryAvailable || state.discoverable} onPress={() => void publication.run('show')} />
        <PageAction title={!state.discoverable ? 'Link only ✓' : 'Link only'} singleLine
          primary={!state.discoverable} disabled={!publication.ready || !publication.discoveryAvailable || !state.discoverable} onPress={() => void publication.run('hide')} />
        <Text style={body}>Link only keeps the page out of discovery. It does not change who is eligible to join.</Text>
      </View>}
      {active && <View style={[s.row, { gap: 12 }]}>
        <Text accessibilityRole="header" style={[s.rowTitle, { fontFamily: fonts.medium }]}>Community link</Text>
        <Text selectable style={body}>{buildCommunityPublicLink(community.handle).replace('https://', '')}</Text>
        <PageAction title={sharing ? 'Opening…' : 'Share link'} singleLine disabled={!publication.ready || sharing} onPress={() => void share()} />
      </View>}
      {active && <View style={{ marginTop: 24 }}><PageAction title="Unpublish" singleLine disabled={!publication.ready} onPress={unpublish} /></View>}
      {!active && !archived && <PageAction title="Community settings" singleLine quiet onPress={() => router.back()} />}
    </>}
    <BrandedAlert visible={!!ownAlert} title={ownAlert?.title ?? ''} message={ownAlert?.message} buttons={ownAlert?.buttons} onClose={() => setAlert(undefined)} />
  </PageFrame>;
}
