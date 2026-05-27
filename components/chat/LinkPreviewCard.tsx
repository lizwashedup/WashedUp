import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLinkPreview } from '../../hooks/useLinkPreview';
import { openUrl } from '../../lib/url';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Rich preview card for the first link in a text message. Renders nothing while
// the fetch is pending or when there's no usable metadata, so a plain link just
// stays a plain link and the feature is silently dormant until og-unfurl is
// deployed. Tapping opens the URL.

interface LinkPreviewCardProps {
  url: string;
  isOwn: boolean;
}

const BANNER_HEIGHT = 140;

export default function LinkPreviewCard({ url, isOwn }: LinkPreviewCardProps) {
  const { preview } = useLinkPreview(url);
  if (!preview) return null;

  const host = (() => {
    try { return new URL(preview.url).hostname.replace(/^www\./, ''); } catch { return null; }
  })();

  return (
    <Pressable
      style={[styles.card, isOwn ? styles.cardOwn : styles.cardOther]}
      onPress={() => openUrl(preview.url)}
      accessibilityRole="link"
      accessibilityLabel={preview.title ?? preview.url}
    >
      {!!preview.image && (
        <Image source={{ uri: preview.image }} style={styles.banner} contentFit="cover" transition={120} />
      )}
      <View style={styles.body}>
        {!!(preview.siteName || host) && (
          <Text style={styles.site} numberOfLines={1}>{preview.siteName ?? host}</Text>
        )}
        {!!preview.title && (
          <Text style={styles.title} numberOfLines={2}>{preview.title}</Text>
        )}
        {!!preview.description && (
          <Text style={styles.description} numberOfLines={2}>{preview.description}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    maxWidth: 280,
  },
  cardOwn: {
    backgroundColor: Colors.overlayWhite,
    borderColor: Colors.overlayLight,
  },
  cardOther: {
    backgroundColor: Colors.parchment,
    borderColor: Colors.border,
  },
  banner: {
    width: '100%',
    height: BANNER_HEIGHT,
    backgroundColor: Colors.inputBg,
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  site: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    lineHeight: 18,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
    lineHeight: 15,
  },
});
