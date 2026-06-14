import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { hapticSuccess, hapticSelection } from '../../../lib/haptics';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import type { IncomingRequest } from '../../../lib/yours/types';

/**
 * One pending request, rendered as an explicit list row. There is NO
 * swipe-to-accept and NO auto-advance: accept and decline are distinct,
 * clearly-labelled buttons that act on THIS person only. Decline is
 * confirm-gated inline (one extra tap) so a mis-tap can't silently drop a
 * real person. Gold/terracotta only, never red.
 */
export default function RequestRow({
  req,
  onAdd,
  onDecline,
  highlighted,
  disabled,
}: {
  req: IncomingRequest;
  onAdd: () => void;
  onDecline: () => void;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = req.first_name_display ?? 'Someone';

  const add = () => {
    if (disabled) return;
    hapticSuccess();
    onAdd();
  };
  const askDecline = () => {
    if (disabled) return;
    hapticSelection();
    setConfirming(true);
  };
  const confirmDecline = () => {
    if (disabled) return;
    setConfirming(false);
    onDecline();
  };

  return (
    <View style={[styles.row, highlighted && styles.rowHighlighted]}>
      <View style={styles.head}>
        <View style={styles.avatarRing}>
          <YoursAvatar
            name={req.first_name_display}
            photoUrl={req.profile_photo_url}
            size={52}
            bucket="none"
          />
        </View>
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.contextChip}>
            <Text style={styles.context} numberOfLines={2}>
              {req.context_line}
            </Text>
          </View>
        </View>
      </View>

      {confirming ? (
        <View style={styles.actions}>
          <Text style={styles.confirmTitle} numberOfLines={1}>
            {COPY.requestDeclineConfirmTitle(name)}
          </Text>
          <View style={styles.confirmBtns}>
            <Pressable
              style={styles.declineConfirm}
              onPress={confirmDecline}
              accessibilityRole="button"
              accessibilityLabel={`${COPY.requestDeclineConfirmYes} ${name}`}
            >
              <Text style={styles.declineConfirmText}>
                {COPY.requestDeclineConfirmYes}
              </Text>
            </Pressable>
            <Pressable
              style={styles.keep}
              onPress={() => setConfirming(false)}
              accessibilityRole="button"
              accessibilityLabel={COPY.requestDeclineConfirmNo}
            >
              <Text style={styles.keepText}>{COPY.requestDeclineConfirmNo}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            style={styles.add}
            onPress={add}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${COPY.requestAdd} ${name}`}
          >
            <Text style={styles.addText}>{COPY.requestAdd}</Text>
          </Pressable>
          <Pressable
            style={styles.decline}
            onPress={askDecline}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${COPY.requestDecline} ${name}`}
          >
            <Text style={styles.declineText}>{COPY.requestDecline}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 14,
    // Soft terracotta lift so the card doesn't read flat on parchment.
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  // The person you tapped in from a notification floats up with a gold ring.
  rowHighlighted: {
    borderWidth: 1.5,
    borderColor: Colors.goldenAmber,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Warm gold ring so a request reads as an invitation, not a profile row.
  avatarRing: {
    padding: 3,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: Colors.goldenAmber,
  },
  meta: { flex: 1, gap: 6 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  contextChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.goldenAmberTint15,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  context: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  add: {
    flex: 1,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  decline: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  declineText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  // Confirm-gated decline (still gold-never-red: neutral fill + quiet keep).
  confirmTitle: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  confirmBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  declineConfirm: {
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  declineConfirmText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  keep: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  keepText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
});
