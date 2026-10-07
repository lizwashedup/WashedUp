/**
 * LinkifiedText - renders free text with any URLs made tappable (terracotta,
 * underlined, opened via openUrl) and visually truncated, so a pasted link
 * (e.g. a long Eventbrite URL in a plan description) reads as a tidy link
 * instead of a wall of raw URL. Plain segments inherit the passed-in style.
 */
import { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, useWindowDimensions } from 'react-native';

import Colors from '../constants/Colors';
import { Fonts } from '../constants/Typography';
import { openUrl, splitOnUrls } from '../lib/url';
import { splitChatMentions } from '../lib/chatMentions';
import { splitIdentityMentions, type ChatMentionDocument } from '../lib/chatMentionIdentity';

const MAX_URL_DISPLAY = 42;

export default function LinkifiedText({
  text,
  style,
  linkStyle,
  mentionNames,
  mentionStyle,
  fullUrls = false,
  mentionDocument,
  onMentionPress,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  mentionNames?: Set<string>;
  mentionStyle?: StyleProp<TextStyle>;
  fullUrls?: boolean;
  mentionDocument?: ChatMentionDocument | null;
  onMentionPress?: (userId: string) => void;
}) {
  const { fontScale } = useWindowDimensions();
  // Cache parsing only. Styles, accessibility and profile callbacks still use
  // current props on every render, including after an account/room change.
  const segments = useMemo(() => {
    const identities = mentionDocument === undefined ? [{ text }] : splitIdentityMentions(text, mentionDocument);
    return identities.map(part => ({
      ...part,
      segments: 'userId' in part && part.userId ? [] : splitOnUrls(part.text).map(segment => ({
        ...segment,
        mentions: segment.isUrl ? [] : splitChatMentions(segment.text, mentionDocument === undefined ? mentionNames : undefined),
      })),
    }));
  }, [text, mentionDocument, mentionNames]);
  // Recreate the native rich-text layout after a Dynamic Type change. On iOS,
  // keeping the same nested Text can retain old line breaks and clip content.
  return (
    <Text key={fontScale} style={style}>
      {segments.map((part, outerIndex) => 'userId' in part && part.userId
        ? <Text key={outerIndex} style={[styles.mention, mentionStyle]}
            accessibilityRole={onMentionPress ? 'link' : undefined}
            accessibilityLabel={onMentionPress ? `View ${part.text.slice(1)} profile` : undefined}
            onPress={onMentionPress ? event => { event.stopPropagation(); onMentionPress(part.userId!); } : undefined}>{part.text}</Text>
        : <Text key={outerIndex}>{part.segments.map((seg, i) =>
        seg.isUrl ? (
          <Text key={i} style={[styles.link, linkStyle]} onPress={() => openUrl(seg.text)}>
            {!fullUrls && seg.text.length > MAX_URL_DISPLAY ? `${seg.text.slice(0, MAX_URL_DISPLAY)}…` : seg.text}
          </Text>
        ) : (
          <Text key={i}>
            {seg.mentions.map((part, partIndex) => part.mention
              ? <Text key={partIndex} style={[styles.mention, mentionStyle]}>{part.text}</Text>
              : <Text key={partIndex}>{part.text}</Text>)}
          </Text>
        ),
      )}</Text>)}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansMedium,
    textDecorationLine: 'underline',
  },
  mention: {
    color: Colors.terracotta,
    fontFamily: Fonts.sansBold,
  },
});
