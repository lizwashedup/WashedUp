import React, {useCallback, useRef} from 'react';
import {ActivityIndicator, Text} from 'react-native';
import {Redirect} from 'expo-router';
import {useCreatorPageScope} from '../../../hooks/useCreatorPageScope';
import {useCreatorPageRead} from '../../../hooks/useCreatorPageRead';
import {useAfterglowFonts} from '../../../hooks/useAfterglowFonts';
import {AfterglowColors} from '../../../constants/Colors';
import {resolveCreatorEventEntry, creatorEventEntryRoute, type CreatorEventEntryIntent, type CreatorEventEntry} from '../../../lib/creatorEventEntry';
import type {CreatorPageScope} from '../../../lib/creatorPageReview';
import {PageAction, PageFrame, pageStyles} from './PageFrame';

export default function CreatorEventEntryGate({intent, openPhotos, returnToTickets, children}: {
  intent: CreatorEventEntryIntent; openPhotos?: boolean; returnToTickets?: boolean; children: React.ReactNode;
}) {
  const {scope, account} = useCreatorPageScope(`event-entry:${intent.kind}:${intent.id}`), {fonts} = useAfterglowFonts(true, 'creator');
  const ordinary = useRef<string | null>(null);
  const identity = `${account.viewerId}:${account.epoch}:${intent.kind}:${intent.id}`;
  // Association is immutable through the creator APIs. Retain an already
  // confirmed ordinary editor across focus changes so unsaved legacy edits
  // are not discarded by remounting. Account/target changes require a new read.
  const read = useCallback(async (owned: CreatorPageScope): Promise<CreatorEventEntry> => {
    if (ordinary.current === identity) return {kind: 'ordinary'};
    const result = await resolveCreatorEventEntry(intent, owned);
    if (owned.isCurrent() && result.kind === 'ordinary') ordinary.current = identity;
    return result;
  }, [identity]);
  const {data, error, loading, refresh} = useCreatorPageRead(scope, read);
  if (!account.error && !account.isLoading && account.isCurrent()) {
    if (ordinary.current === identity) return <React.Fragment key={identity}>{children}</React.Fragment>;
    if (scope?.isCurrent() && !error && !loading && data?.kind === 'page') return <Redirect href={creatorEventEntryRoute(intent, data, {openPhotos, returnToTickets}) as never} />;
  }
  return <PageFrame title="Your event">
    {loading || account.isLoading ? <ActivityIndicator accessibilityLabel="Checking event access" color={AfterglowColors.clay} /> : <>
      <Text accessibilityRole="alert" style={[pageStyles.body, {fontFamily: fonts.regular}]}>Couldn’t open this event or template. Check your account and page access, then try again.</Text>
      <PageAction title="Check access" singleLine onPress={() => void (account.error ? account.retry() : refresh()).catch(() => undefined)} />
    </>}
  </PageFrame>;
}
