import { Image } from 'expo-image';
import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';

// 1080x1350 (4:5) off-screen canvas captured by react-native-view-shot to
// produce a branded composite for sharing. Lives off-screen at top: -20000 so
// it renders into the layout tree (required for capture) without ever being
// visible. The album detail screen passes the currently-viewed photo URI +
// plan title into props and then captures the ref.

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const FOOTER_H = 220;

export type BrandedShareCanvasProps = {
  photoUri: string | null;
  title: string;
  dateText: string;
};

export const BrandedShareCanvas = forwardRef<View, BrandedShareCanvasProps>(
  function BrandedShareCanvas({ photoUri, title, dateText }, ref) {
    return (
      <View
        ref={ref}
        collapsable={false}
        style={styles.canvas}
      >
        <View style={styles.photoArea}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]} />
          )}
        </View>
        <View style={styles.footer}>
          <Image
            source={require('../../assets/images/wordmark-w.png')}
            style={styles.wordmark}
            contentFit="contain"
          />
          <View style={styles.footerText}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <Text style={styles.meta} numberOfLines={1}>{dateText}</Text>
            <Text style={styles.brand}>washedup</Text>
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute', top: -20000, left: 0,
    width: CANVAS_W, height: CANVAS_H,
    backgroundColor: Colors.parchment,
  },
  photoArea: { width: CANVAS_W, height: CANVAS_H - FOOTER_H, backgroundColor: Colors.inputBg },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { backgroundColor: Colors.inputBg },
  footer: {
    width: CANVAS_W, height: FOOTER_H,
    backgroundColor: Colors.parchment,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 56, gap: 32,
  },
  wordmark: { width: 140, height: 140 },
  footerText: { flex: 1, gap: 4 },
  title: { fontFamily: Fonts.displayBold, fontSize: 56, color: Colors.asphalt, lineHeight: 64 },
  meta: { fontFamily: Fonts.sans, fontSize: 28, color: Colors.warmGray, marginTop: 4 },
  brand: { fontFamily: Fonts.sansBold, fontSize: 26, color: Colors.terracotta, letterSpacing: 1, marginTop: 8 },
});
