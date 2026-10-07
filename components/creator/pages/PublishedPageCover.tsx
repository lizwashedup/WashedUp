import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { usePublicPageScope } from '../../../hooks/usePublicPageScope';
import { SceneDetailColors } from '../../../constants/Colors';
import { Pressable } from 'react-native';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { loadPublishedPageCoverSource, type PageImageScope } from '../../../lib/publishedPageCover';
import { ScopedPageCover } from './PageCover';
import { PageAction, pageStyles } from './PageFrame';
/** Shares private-cover decoding/retry; publication resolution never reads a creator draft. */
export function PublishedPageCover({ pageId, mediaId, height, surface = 'light' }: { pageId: string; mediaId: string; height: number; surface?: 'light' | 'scene' }) {
  const { scope, account } = usePublicPageScope(`${pageId}:${mediaId}`);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const load = useCallback((owned: PageImageScope) => loadPublishedPageCoverSource(pageId, mediaId, owned), [pageId, mediaId]);
  if (account.error) return <View style={{ height, justifyContent: 'center' }}><Text accessibilityRole="alert" style={[pageStyles.small, { fontFamily: fonts.regular }, surface === 'scene' && { color: SceneDetailColors.text }]}>Could not check this cover’s access.</Text>
    {surface === 'scene' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry photo" onPress={() => { void account.retry(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[pageStyles.small, { color: SceneDetailColors.text, fontFamily: fonts.regular }]}>Retry photo</Text></Pressable> : <PageAction quiet title="Retry photo" onPress={() => { void account.retry(); }} />}</View>;
  return <ScopedPageCover pageId={pageId} mediaId={mediaId} scope={scope} loadSource={load} height={height} surface={surface} />;
}
