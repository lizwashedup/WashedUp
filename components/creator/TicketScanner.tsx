/**
 * The scan layer of door mode (spec 100 P0 #5), isolated so it is the ONLY
 * place expo-camera is imported. door.tsx lazy-loads this, so the type-a-code
 * path never touches the native camera module and ships independently of the
 * EAS build that adds it (Cowork: scan must not block the door). expo-camera is
 * a native module, so this component only functions in a build that includes it.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';

interface TicketScannerProps {
  /** fired with the raw scanned string; the parent normalizes + checks in */
  onScan: (raw: string) => void;
  /** while a check-in is in flight, the parent pauses scanning */
  busy: boolean;
}

export default function TicketScanner({ onScan, busy }: TicketScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.terracotta} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permWrap}>
        {/* copy to the taste gate */}
        <Text style={styles.permText}>let the camera read tickets at the door.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>turn on the camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : (r: BarcodeScanningResult) => onScan(r.data ?? '')}
      />
      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color={Colors.white} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraWrap: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: Colors.darkWarm, maxHeight: 420 },
  camera: { flex: 1 },
  busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  permWrap: { alignItems: 'center', gap: EventSpacing.md, paddingHorizontal: 20 },
  permText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: Colors.terracotta, borderRadius: 999, paddingVertical: 16, paddingHorizontal: 28,
    alignItems: 'center', minHeight: 44, justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
