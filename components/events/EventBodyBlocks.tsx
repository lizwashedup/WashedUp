/**
 * The mood-board body render (doc 61 §4c, doc 76 §3): the ordered
 * description_blocks drawn richly on the buyer page - text in the body
 * face, images full-width, the faq marker replaced by the good-to-know
 * cards. When no marker is placed the cards close the body (70's
 * block-order default). Falls back to nothing; the caller keeps the
 * legacy plain description for null bodies.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { EventMediaImage } from './EventMediaImage';
import { EventMediaVideo } from './EventMediaVideo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { hapticLight } from '../../lib/haptics';
import Colors, { SceneDetailColors } from '../../constants/Colors';
import { EventSurface } from '../../constants/EventDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
import LinkifiedText from '../LinkifiedText';
import { type DescriptionBlock } from '../../lib/eventContent';
import { EventFaqCards } from './EventFaqCards';

const BODY_IMAGE_HEIGHT = 220;
// law 2/16: landscape 16:9 is the stated best shape, so the frame is
// system-fixed - an organizer can never letterbox or stretch the page
const BODY_VIDEO_ASPECT = 16 / 9;

/** law 1: the media zones are the ONE place the base goes warm-dark, so
 *  real footage reads cinematic against the cream page. */
function BodyVideo({ eventId, path, poster }: { eventId: string; path: string; poster?: string }) {
  return <View style={styles.videoFrame}>
    {!!poster && <EventMediaImage eventId={eventId} reference={poster} kind="poster" style={styles.videoPoster} contentFit="cover" />}
    <EventMediaVideo eventId={eventId} path={path} style={styles.video} />
  </View>;
}

interface EventBodyBlocksProps {
  eventId: string;
  blocks: DescriptionBlock[];
  surface?: 'light' | 'scene';
}

export function EventBodyBlocks({ eventId, blocks, surface = 'light' }: EventBodyBlocksProps) {
  const markerPlaced = blocks.some((b) => b.type === 'faq');
  // P2 (law 3): tapping a body image opens the lightbox on the warm-dark
  // media ground - the proof-of-good reads cinematic full-screen
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <LinkifiedText key={`t-${index}`} text={block.content} style={[styles.bodyText, surface === 'scene' && { color: SceneDetailColors.text }]} linkStyle={surface === 'scene' ? { color: SceneDetailColors.text } : undefined} />
          );
        }
        if (block.type === 'image') {
          const path = block.path;
          return (
            <TouchableOpacity
              key={`i-${index}`}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={block.alt ? `Open photo: ${block.alt}` : "Open event photo"}
              onPress={() => {
                hapticLight();
                setLightbox(path);
              }}
            >
              <EventMediaImage
                eventId={eventId} reference={path} kind="image"
                style={styles.bodyImage}
                contentFit="cover"
                accessibilityLabel={block.alt}
              />
            </TouchableOpacity>
          );
        }
        if (block.type === 'video') {
          return <BodyVideo key={`v-${index}`} eventId={eventId} path={block.path} poster={block.poster} />;
        }
        return <EventFaqCards key={`f-${index}`} eventId={eventId} surface={surface} />;
      })}
      {!markerPlaced && <EventFaqCards eventId={eventId} surface={surface} />}

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={styles.lightbox} onPress={() => setLightbox(null)}>
          {!!lightbox && (
            <EventMediaImage eventId={eventId} reference={lightbox} kind="image" style={styles.lightboxImage} contentFit="contain" />
          )}
          <SafeAreaView style={styles.lightboxClose} pointerEvents="box-none">
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setLightbox(null)} hitSlop={12} style={styles.lightboxCloseBtn}>
              <X size={22} color={EventSurface.onMedia} strokeWidth={2} />
            </TouchableOpacity>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  bodyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt, lineHeight: 22 },
  bodyImage: { width: '100%', height: BODY_IMAGE_HEIGHT, borderRadius: 12, backgroundColor: EventSurface.media },
  videoFrame: {
    width: '100%',
    aspectRatio: BODY_VIDEO_ASPECT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: EventSurface.media,
  },
  video: { width: '100%', height: '100%' },
  videoPoster: { ...StyleSheet.absoluteFillObject },
  lightbox: { flex: 1, backgroundColor: EventSurface.media, alignItems: 'center', justifyContent: 'center' },
  lightboxImage: { width: '100%', height: '100%' },
  lightboxClose: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', paddingHorizontal: 16 },
  lightboxCloseBtn: { padding: 8 },
});
