/**
 * LF-01: the global state contract, shared and reusable, native half.
 *
 * Before this file, loading/empty/offline/permission/validation/archived
 * markup was hand-rolled per screen (confirmation and send-error already had
 * real shared infra: components/BrandedAlert.tsx + lib/friendlyError.ts).
 * This file is the other six states, in one place, on the same Golden Hour
 * tokens, so a screen picks a component instead of re-inventing markup:
 *
 *   - LoadingState    a centered spinner. Use while the first read is in flight.
 *   - EmptyState      a warm invitation, never "nothing here." Always pair
 *                      with a concrete next action per the CLAUDE.md empty
 *                      state rule; title/sub/cta are the caller's real copy.
 *   - OfflineBanner   a thin, non-blocking strip. Pair with hooks/useNetworkStatus.
 *   - PermissionState a full-width notice for "you no longer have access
 *                      here" (removed/banned/revoked), distinct from a
 *                      validation problem: this is about WHO you are, not
 *                      what you typed.
 *   - ValidationText  one inline field-level problem line.
 *   - ArchivedNotice  a closed/expired surface (a room, a listing) that still
 *                      renders its content read-only above this notice,
 *                      rather than a blocking dead end.
 *
 * None of these call the network or own state; they are pure presentation,
 * same as BrandedAlert. A screen still decides WHEN to show which.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';

export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.centered} accessibilityRole="none" accessibilityLabel={label ?? 'loading'}>
      <ActivityIndicator size="large" color={Colors.terracotta} />
    </View>
  );
}

export function EmptyState({
  title,
  sub,
  ctaLabel,
  onPress,
}: {
  title: string;
  sub?: string;
  ctaLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!sub && <Text style={styles.emptySub}>{sub}</Text>}
      {!!ctaLabel && !!onPress && (
        <TouchableOpacity
          style={styles.emptyCta}
          onPress={onPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Text style={styles.emptyCtaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** A thin, non-blocking strip. Render it; don't hide the composer/content beneath it. */
export function OfflineBanner({ label }: { label?: string }) {
  return (
    <View style={styles.offlineBanner} accessibilityLiveRegion="polite">
      <Text style={styles.offlineText}>
        {label ?? "you're offline. this will pick back up once you're back."}
      </Text>
    </View>
  );
}

/** "You no longer have access" — removed/banned/revoked. Not a validation problem. */
export function PermissionState({ message }: { message: string }) {
  return (
    <View style={styles.permissionWrap}>
      <Text style={styles.permissionText}>{message}</Text>
    </View>
  );
}

/** One inline field-level problem line. */
export function ValidationText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <Text style={styles.validationText}>{message}</Text>;
}

/** A closed/expired surface. Render real content above this, not instead of it. */
export function ArchivedNotice({ message }: { message: string }) {
  return (
    <View style={styles.archivedWrap}>
      <Text style={styles.archivedText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  emptyTitle: {
    fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm, textAlign: 'center',
  },
  emptySub: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD,
    color: Colors.secondary, textAlign: 'center', marginTop: 8, marginBottom: 20,
  },
  emptyCta: {
    backgroundColor: Colors.terracotta, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12,
    shadowColor: Colors.terracotta, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  emptyCtaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  offlineBanner: { backgroundColor: Colors.inputBg, paddingVertical: 6, paddingHorizontal: 16 },
  offlineText: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.secondary, textAlign: 'center',
  },
  permissionWrap: {
    paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  permissionText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, textAlign: 'center' },
  validationText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.errorRed, marginTop: 4 },
  archivedWrap: {
    paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  archivedText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, textAlign: 'center' },
});
