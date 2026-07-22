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
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import LinkifiedText from '../LinkifiedText';
import { eventContentPublicUrl, type DescriptionBlock } from '../../lib/eventContent';
import { EventFaqCards } from './EventFaqCards';

const BODY_IMAGE_HEIGHT = 220;

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
        return <EventFaqCards key={`f-${index}`} eventId={eventId} />;
      })}
      {!markerPlaced && <EventFaqCards eventId={eventId} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  bodyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt, lineHeight: 22 },
  bodyImage: { width: '100%', height: BODY_IMAGE_HEIGHT, borderRadius: 12, backgroundColor: Colors.inputBg },
});
