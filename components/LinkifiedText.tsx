/**
 * LinkifiedText - renders free text with any URLs made tappable (terracotta,
 * underlined, opened via openUrl) and visually truncated, so a pasted link
 * (e.g. a long Eventbrite URL in a plan description) reads as a tidy link
 * instead of a wall of raw URL. Plain segments inherit the passed-in style.
 */
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import Colors from '../constants/Colors';
import { Fonts } from '../constants/Typography';
import { openUrl, splitOnUrls } from '../lib/url';

const MAX_URL_DISPLAY = 42;

export default function LinkifiedText({
  text,
  style,
  linkStyle,
  mentionNames,
  mentionStyle,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  mentionNames?: Set<string>;
  mentionStyle?: StyleProp<TextStyle>;
}) {
  const segments = splitOnUrls(text);
  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.isUrl ? (
          <Text key={i} style={[styles.link, linkStyle]} onPress={() => openUrl(seg.text)}>
            {seg.text.length > MAX_URL_DISPLAY ? `${seg.text.slice(0, MAX_URL_DISPLAY)}…` : seg.text}
          </Text>
        ) : (
          <Text key={i}>
            {seg.text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, partIndex) => {
              const isMention = part.startsWith('@') && mentionNames?.has(part.slice(1).toLowerCase());
              return isMention
                ? <Text key={partIndex} style={[styles.mention, mentionStyle]}>{part}</Text>
                : <Text key={partIndex}>{part}</Text>;
            })}
          </Text>
        ),
      )}
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
