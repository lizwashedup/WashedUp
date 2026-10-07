import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import { RotateCcw } from 'lucide-react-native';
import { EventSurface } from '../../constants/EventDesign';
import { eventMediaReference, isProtectedEventMedia, type EventMediaKind } from '../../lib/eventMediaSource';
import { useEventMediaSource } from '../../hooks/useEventMediaSource';

type Props = Omit<ImageProps, 'source'> & { eventId: string; reference: string; kind?: Exclude<EventMediaKind, 'video'> };

/** Legacy artwork retains its original loading/cache/fallback behavior. */
export function EventMediaImage({ eventId, reference, kind = 'cover', ...props }: Props) {
  if (!isProtectedEventMedia(reference)) {
    const parsed = eventMediaReference(eventId, reference, kind);
    return parsed.type === 'legacy' ? <Image {...props} source={{ uri: parsed.uri }} /> : null;
  }
  return <ProtectedImage key={`${eventId}:${kind}:${reference}`} eventId={eventId} reference={reference} kind={kind} {...props} />;
}

function ProtectedImage({ eventId, reference, kind = 'cover', onLoad, onError: _legacyError, style, ...props }: Props) {
  const media = useEventMediaSource(eventId, reference, kind);
  if (media.source) return <Image {...props} style={style} source={media.source} cachePolicy="none"
    recyclingKey={`${eventId}:${reference}:${media.generation}`} transition={0}
    onLoad={event => { if (media.current()) onLoad?.(event); }} onError={media.fail} />;
  // A failed private read stays retryable; legacy fallback callbacks cannot hide it.
  return <View style={[style, styles.placeholder]}>
    {media.error ? <Pressable accessibilityRole="button" accessibilityLabel="Photo unavailable. Retry photo" onPress={media.retry} style={styles.retry}>
      <RotateCcw size={20} color={EventSurface.onMedia} />
    </Pressable> : <ActivityIndicator color={EventSurface.onMedia} accessibilityLabel="Loading photo" />}
  </View>;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: EventSurface.media, alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
