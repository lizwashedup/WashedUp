import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { loadPageCoverSource } from '../../../lib/creatorPageMedia';
import type { PageImageScope } from '../../../lib/publishedPageCover';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { AfterglowType as T } from '../../../constants/Typography';
import { AfterglowColors as C, SceneDetailColors } from '../../../constants/Colors';
import { PageAction, pageStyles as s } from './PageFrame';
type Props = { pageId: string; mediaId: string; scope: CreatorPageScope | null; thumbnail?: boolean; contentFit?: 'contain' | 'cover'; compactFallback?: boolean; height?: number; onReady?: (ready: boolean) => void };
type SharedProps<S extends PageImageScope> = Omit<Props, 'scope'> & { scope: S | null; height?: number; surface?: 'light' | 'scene'; loadSource: (scope: S) => Promise<Source> };
type Source = Awaited<ReturnType<typeof loadPageCoverSource>>;
export function PageCover(props: Props) {
  const loadSource = useCallback((scope: CreatorPageScope) => loadPageCoverSource(props.pageId, props.mediaId, scope), [props.pageId, props.mediaId]);
  return <ScopedPageCover {...props} loadSource={loadSource} />;
}
export function ScopedPageCover<S extends PageImageScope>(props: SharedProps<S>) {
  return <CoverImage key={`${props.scope?.userId}:${props.pageId}:${props.mediaId}`} {...props} />;
}
function CoverImage<S extends PageImageScope>({ pageId, mediaId, scope, thumbnail = false, contentFit = 'contain', compactFallback = false, onReady, height, surface = 'light', loadSource }: SharedProps<S>) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const callback = useRef(onReady); callback.current = onReady;
  const generation = useRef(0);
  const [retry, setRetry] = useState(0), [aspect, setAspect] = useState(4 / 3);
  const [state, setState] = useState<{ scope: S; generation: number; source?: Source; error?: boolean }>();
  useEffect(() => {
    const request = ++generation.current;
    let alive = true;
    setState(undefined); callback.current?.(false);
    // Parent focus/account effects must finish before the child starts authentication.
    void Promise.resolve().then(async () => {
      if (!alive || !scope?.isCurrent()) return;
      try {
        const source = await loadSource(scope);
        if (alive && scope.isCurrent() && generation.current === request) setState({ scope, generation: request, source });
      } catch {
        if (alive && scope.isCurrent() && generation.current === request) setState({ scope, generation: request, error: true });
      }
    });
    return () => { alive = false; generation.current++; };
  }, [scope, pageId, mediaId, retry, loadSource]);
  const visible = state?.scope === scope && scope?.isCurrent() ? state : undefined;
  const active = () => !!visible && scope?.isCurrent() && generation.current === visible.generation;
  return <View style={height ? { width: '100%', height, justifyContent: 'center' } : thumbnail ? { width: 74 } : { width: '100%', aspectRatio: aspect, marginBottom: 16, justifyContent: 'center' }}>
    {visible?.source && !visible.error ? <Image source={visible.source} contentFit={contentFit} cachePolicy="none"
      recyclingKey={`${scope?.userId}:${pageId}:${mediaId}:${retry}`} accessibilityLabel="Page cover" accessible
      style={height ? { width: '100%', height } : thumbnail ? { width: 74, height: 84 } : { width: '100%', aspectRatio: aspect }}
      onLoad={event => { if (!active()) return; if (event.source.width && event.source.height) setAspect(Math.max(4 / 3, event.source.width / event.source.height)); callback.current?.(true); }}
      onError={() => { if (!active()) return; setState({ ...visible, error: true }); callback.current?.(false); }} /> : !visible?.error ?
      <ActivityIndicator color={surface === 'scene' ? SceneDetailColors.text : C.clay} accessibilityLabel="Loading page cover" /> : null}
    {visible?.error && compactFallback ? <Text style={[T.caption, { color: C.muted, fontFamily: fonts.regular, textAlign: 'center' }]}>Photo unavailable</Text> : visible?.error && <View><Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }, surface === 'scene' && { color: SceneDetailColors.text }]}>This cover could not be loaded.</Text>
      {surface === 'scene' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry photo" onPress={() => { callback.current?.(false); setRetry(value => value + 1); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[s.small, { color: SceneDetailColors.text, fontFamily: fonts.regular }]}>Retry photo</Text></Pressable> : <PageAction quiet title="Retry photo" onPress={() => { callback.current?.(false); setRetry(value => value + 1); }} />}</View>}
  </View>;
}
