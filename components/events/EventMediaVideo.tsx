import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { EventSurface } from '../../constants/EventDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
import { eventMediaReference, isProtectedEventMedia } from '../../lib/eventMediaSource';
import { useEventMediaSource } from '../../hooks/useEventMediaSource';

type Props = { eventId: string; path: string; style: StyleProp<ViewStyle> };
export function EventMediaVideo({ eventId, path, style }: Props) {
  if (isProtectedEventMedia(path)) return <ProtectedVideo key={`${eventId}:${path}`} {...{ eventId, path, style }} />;
  const parsed = eventMediaReference(eventId, path, 'video');
  return parsed.type === 'legacy' ? <Player source={parsed.uri} style={style} /> : null;
}

function ProtectedVideo({ eventId, path, style }: Props) {
  const media = useEventMediaSource(eventId, path, 'video');
  // The installed Expo web player cannot attach request headers. Never give it a private URL.
  if (Platform.OS === 'web') return <View style={[style, styles.center]}><Text style={styles.message}>Video unavailable in this preview.</Text></View>;
  if (media.source) return <Player key={media.generation} source={media.source} style={style} onError={media.fail} />;
  return <View style={[style, styles.center]}>{media.error ?
    <Pressable accessibilityRole="button" accessibilityLabel="Video unavailable. Retry video" onPress={media.retry} style={styles.retry}><Text style={styles.message}>Retry video</Text></Pressable> :
    <ActivityIndicator color={EventSurface.onMedia} accessibilityLabel="Loading video" />}</View>;
}

/** Unmounting releases the player and its buffered private source on scope retirement. */
function Player({ source, style, onError }: { source: VideoSource; style: StyleProp<ViewStyle>; onError?: () => void }) {
  const player = useVideoPlayer(source, p => { p.loop = false; });
  useEffect(() => {
    if (!onError) return;
    if (player.status === 'error') onError();
    const listener = player.addListener('statusChange', event => { if (event.status === 'error') onError(); });
    return () => listener.remove();
  }, [player, onError]);
  return <VideoView player={player} style={style} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  message: { color: EventSurface.onMedia, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM },
});
