/**
 * The mood-board body render (doc 61 §4c, doc 76 §3): the ordered
 * description_blocks drawn richly on the buyer page - text in the body
 * face, images full-width, the faq marker replaced by the good-to-know
 * cards. When no marker is placed the cards close the body (70's
 * block-order default). Falls back to nothing; the caller keeps the
 * legacy plain description for null bodies.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '../../constants/Colors';
import { EventSurface } from '../../constants/EventDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
import LinkifiedText from '../LinkifiedText';
import { eventContentPublicUrl, type DescriptionBlock } from '../../lib/eventContent';
import { EventFaqCards } from './EventFaqCards';

const BODY_IMAGE_HEIGHT = 220;
// law 2/16: landscape 16:9 is the stated best shape, so the frame is
// system-fixed - an organizer can never letterbox or stretch the page
const BODY_VIDEO_ASPECT = 16 / 9;

/** law 1: the media zones are the ONE place the base goes warm-dark, so
 *  real footage reads cinematic against the cream page. */
function BodyVideo({ path }: { path: string }) {
  const player = useVideoPlayer(eventContentPublicUrl(path), (p) => {
    p.loop = false;
  });
  return (
    <View style={styles.videoFrame}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
      />
    </View>
  );
}

interface EventBodyBlocksProps {
  eventId: string;
  blocks: DescriptionBlock[];
}

export function EventBodyBlocks({ eventId, blocks }: EventBodyBlocksProps) {
  const markerPlaced = blocks.some((b) => b.type === 'faq');

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <LinkifiedText key={`t-${index}`} text={block.content} style={styles.bodyText} />
          );
        }
        if (block.type === 'image') {
          return (
            <Image
              key={`i-${index}`}
              source={{ uri: eventContentPublicUrl(block.path) }}
              style={styles.bodyImage}
              contentFit="cover"
              accessibilityLabel={block.alt}
            />
          );
        }
        if (block.type === 'video') {
          return <BodyVideo key={`v-${index}`} path={block.path} />;
        }
        return <EventFaqCards key={`f-${index}`} eventId={eventId} />;
      })}
      {!markerPlaced && <EventFaqCards eventId={eventId} />}
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
});
