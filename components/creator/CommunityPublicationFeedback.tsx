import React from 'react';
import { View } from 'react-native';
import { ScaledText as Text } from '../ScaledText';
import { PageAction, pageStyles } from './pages/PageFrame';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import type { useCommunityPublication } from '../../hooks/useCommunityPublication';

export function CommunityPublicationFeedback({ publication }: { publication: ReturnType<typeof useCommunityPublication> }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const { loading, error, needsCheck, message, busy, attempt } = publication;
  if (!loading && !error && !needsCheck && !message) return null;
  return <View style={pageStyles.notice}>
    <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite"
      style={[pageStyles.small, { fontFamily: fonts.regular }]}>
      {busy ? (publication.activeAction === 'check' ? 'Checking the saved status…' : 'Saving…') : loading ? 'Checking visibility…' : error ?? message ?? 'An earlier change needs to be checked before continuing.'}
    </Text>
    {!!error && !needsCheck && <PageAction title="Try again" singleLine disabled={busy} onPress={publication.refresh} />}
    {needsCheck && <PageAction title="Check status" singleLine disabled={busy} onPress={() => void publication.run('check')} />}
    {!!attempt && !error && <PageAction title="Retry change" singleLine disabled={busy} onPress={() => void publication.run('retry')} />}
  </View>;
}
