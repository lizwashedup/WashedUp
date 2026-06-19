/**
 * MenuCard - one shared "anchored bloom" menu, used everywhere a contextual
 * menu is needed (People long-press, DM chat "+"). Replaces the native iOS
 * context menu and the gray chat "+" pill stack with one learned pattern: the
 * card always blooms from the thing you pressed, never floats centered.
 *
 * Anatomy (design spec, person-menu-system-design-spec.md):
 *   - warm cream surface, radius 16, the corner nearest the anchor clipped to 4
 *     so the card visibly points at its trigger.
 *   - warm sepia scrim behind (Colors.scrimSepia), never system gray-black.
 *   - left-aligned rows: 18pt lucide line icon (terracotta, or muted for a
 *     passive "looking" row), DM Sans medium label, secondary subtitle under it.
 *   - a hairline divider before any passive row (separates doing from looking).
 *   - springs in scale 0.9 -> 1.0 + fade ~150ms; rows stagger a 30ms fade-up.
 *   - one soft haptic on open, none on dismiss; tap scrim / Android back closes.
 *
 * Front-end only. Copy is owned by callers (locked in constants.COPY).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type IconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export interface MenuRow {
  key: string;
  icon: IconCmp;
  label: string;
  subtitle: string;
  onPress: () => void;
  /** Passive "looking" action (e.g. View profile): muted tone, not terracotta. */
  muted?: boolean;
  /** Draw a hairline divider above this row (separates doing from looking). */
  dividerBefore?: boolean;
}

const CARD_W = 264;
const GAP = 8;
const SCREEN_MARGIN = 12;
const ROW_H = 52;
const DIVIDER_SPACE = 9; // hairline + its vertical margins
const CARD_PAD_V = 6;
const RADIUS = 16;
const CLIP = 4;
const ICON = 18;
const FACE_SCALE = 1.05;
const RING = 3;

function estCardHeight(rows: MenuRow[]): number {
  return (
    CARD_PAD_V * 2 +
    rows.length * ROW_H +
    rows.filter((r) => r.dividerBefore).length * DIVIDER_SPACE
  );
}

/**
 * One menu row. A dedicated component so each row owns its press state: a
 * Pressable *function* style does not apply reliably inside this Modal, so we
 * drive the warmTint press tint from local state with a plain array style.
 */
function MenuRowItem({
  row,
  index,
  onClose,
}: {
  row: MenuRow;
  index: number;
  onClose: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const Icon = row.icon;
  return (
    <Animated.View entering={FadeInUp.duration(150).delay(index * 30)}>
      <Pressable
        onPress={() => {
          onClose();
          row.onPress();
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.row, pressed && styles.rowPressed]}
        android_ripple={{ color: Colors.warmTint }}
        accessibilityRole="button"
        accessibilityLabel={`${row.label}. ${row.subtitle}.`}
      >
        <View style={styles.iconBox}>
          <Icon size={ICON} color={row.muted ? Colors.secondary : Colors.terracotta} strokeWidth={1.75} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, row.muted && styles.rowLabelMuted]} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {row.subtitle}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function MenuCard({
  visible,
  onClose,
  onClosed,
  anchor,
  placement,
  rows,
  anchorAvatar,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fires once the dismiss animation finishes and the modal has unmounted.
   * Use to open a follow-on modal without two modals overlapping (iOS drops
   * the second when one is mid-dismiss). */
  onClosed?: () => void;
  anchor: AnchorRect | null;
  /** 'avatar' blooms below/above a face; 'top-right' drops down from the + button. */
  placement: 'avatar' | 'top-right';
  rows: MenuRow[];
  /** Surface A only: the pressed face, redrawn ringed + scaled above the scrim. */
  anchorAvatar?: { name: string | null; photoUrl: string | null };
}) {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const [render, setRender] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setRender(true);
      hapticLight();
      progress.value = withTiming(1, { duration: 150 });
    } else {
      progress.value = withTiming(0, { duration: 120 }, (finished) => {
        if (finished) {
          runOnJS(setRender)(false);
          if (onClosed) runOnJS(onClosed)();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + 0.1 * progress.value }],
  }));

  if (!render || !anchor) return null;

  // Placement + which corner clips toward the trigger.
  const estH = estCardHeight(rows);
  let cardPos: { top: number; left?: number; right?: number };
  let clipCorner: 'topLeft' | 'topRight' | 'bottomLeft';

  if (placement === 'top-right') {
    cardPos = {
      top: anchor.y + anchor.height + GAP,
      right: Math.max(SCREEN_MARGIN, SCREEN_W - (anchor.x + anchor.width)),
    };
    clipCorner = 'topRight';
  } else {
    const left = Math.min(
      Math.max(anchor.x, SCREEN_MARGIN),
      SCREEN_W - CARD_W - SCREEN_MARGIN,
    );
    const below = anchor.y + anchor.height + GAP;
    if (below + estH > SCREEN_H - SCREEN_MARGIN) {
      cardPos = { top: Math.max(SCREEN_MARGIN, anchor.y - GAP - estH), left };
      clipCorner = 'bottomLeft';
    } else {
      cardPos = { top: below, left };
      clipCorner = 'topLeft';
    }
  }

  const clipStyle =
    clipCorner === 'topRight'
      ? { borderTopRightRadius: CLIP }
      : clipCorner === 'bottomLeft'
        ? { borderBottomLeftRadius: CLIP }
        : { borderTopLeftRadius: CLIP };

  const faceInitial = (anchorAvatar?.name?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose} animationType="none">
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      </Animated.View>

      {anchorAvatar && (
        <View
          style={[
            styles.faceClone,
            {
              top: anchor.y,
              left: anchor.x,
              width: anchor.width,
              height: anchor.height,
              borderRadius: anchor.width / 2,
            },
          ]}
          accessibilityLabel={anchorAvatar.name ?? 'Person'}
        >
          {anchorAvatar.photoUrl ? (
            <Image source={{ uri: anchorAvatar.photoUrl }} style={styles.faceImg} contentFit="cover" />
          ) : (
            <Text style={styles.faceInitial}>{faceInitial}</Text>
          )}
        </View>
      )}

      <Animated.View
        style={[styles.card, cardPos, clipStyle, cardStyle]}
        accessibilityViewIsModal
      >
        {rows.map((row, i) => (
          <React.Fragment key={row.key}>
            {row.dividerBefore && <View style={styles.divider} />}
            <MenuRowItem row={row} index={i} onClose={onClose} />
          </React.Fragment>
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrimSepia },
  card: {
    position: 'absolute',
    width: CARD_W,
    paddingVertical: CARD_PAD_V,
    backgroundColor: Colors.cream,
    borderRadius: RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  row: {
    minHeight: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rowPressed: { backgroundColor: Colors.warmTint },
  iconBox: { width: ICON, height: ICON, marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  rowLabelMuted: { color: Colors.secondary },
  rowSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.secondary,
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.dividerWarm,
    marginVertical: 4,
    marginHorizontal: 16,
  },
  faceClone: {
    position: 'absolute',
    borderWidth: RING,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transform: [{ scale: FACE_SCALE }],
  },
  faceImg: { width: '100%', height: '100%' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
});
