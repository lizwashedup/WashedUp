/**
 * MarkEarnedModal — Full-screen overlay shown when a user earns a new mark.
 * Shown one at a time. Feels like opening a letter — no confetti, no sound.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import MarkIcon from './MarkIcons';

interface EarnedMark {
  id: string;          // user_marks.id
  mark_id: string;
  slug: string;
  name: string;
  description: string;
  type: 'milestone' | 'identity';
  icon_name: string;
}

interface Props {
  userId: string;
}

export default function MarkEarnedModal({ userId }: Props) {
  const [queue, setQueue] = useState<EarnedMark[]>([]);
  const [current, setCurrent] = useState<EarnedMark | null>(null);

  // Fetch unseen marks on mount
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data, error } = await supabase
        .from('user_marks')
        .select('id, mark_id, seen, marks!inner(slug, name, description, type, icon_name)')
        .eq('user_id', userId)
        .eq('seen', false)
        .order('earned_at', { ascending: true });

      if (error || !data?.length) return;

      const marks: EarnedMark[] = data.map((row: any) => ({
        id: row.id,
        mark_id: row.mark_id,
        slug: row.marks.slug,
        name: row.marks.name,
        description: row.marks.description,
        type: row.marks.type,
        icon_name: row.marks.icon_name,
      }));

      setQueue(marks);
      setCurrent(marks[0]);
    })();
  }, [userId]);

  const dismiss = useCallback(async () => {
    if (!current) return;

    // Mark as seen
    await supabase
      .from('user_marks')
      .update({ seen: true })
      .eq('id', current.id);

    const remaining = queue.filter((m) => m.id !== current.id);
    setQueue(remaining);
    setCurrent(remaining.length > 0 ? remaining[0] : null);
  }, [current, queue]);

  const handlePin = useCallback(async () => {
    if (!current) return;

    // Pin this identity mark to profile
    await supabase
      .from('profiles')
      .update({ pinned_mark_id: current.mark_id })
      .eq('id', userId);

    dismiss();
  }, [current, userId, dismiss]);

  if (!current) return null;

  const isIdentity = current.type === 'identity';

  return (
    <Modal visible transparent animationType="none">
      <Animated.View entering={FadeIn.duration(300)} style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <Text style={styles.header}>YOU EARNED A MARK</Text>

          {/* Icon container */}
          <View style={[styles.iconContainer, isIdentity ? styles.iconSquare : styles.iconCircle]}>
            <MarkIcon iconName={current.icon_name} size={72} />
          </View>

          {/* Mark name */}
          <Text style={styles.markName}>{current.name}</Text>

          {/* Description */}
          <Text style={styles.markDescription}>{current.description}</Text>

          {/* Actions */}
          {isIdentity ? (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.pinButton} onPress={handlePin} activeOpacity={0.8}>
                <Text style={styles.pinButtonText}>Pin to profile</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={dismiss} activeOpacity={0.7}>
                <Text style={styles.maybeLaterText}>Maybe later</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.dismissButton} onPress={dismiss} activeOpacity={0.8}>
              <Text style={styles.dismissButtonText}>Got it</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FDF8F4',
    borderRadius: 20,
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 32,
    marginHorizontal: 36,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
  },
  header: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: '#9B8B7A',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 24,
  },
  iconContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.parchment,
    marginBottom: 20,
  },
  iconCircle: {
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  iconSquare: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  markName: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.asphalt,
    marginBottom: 8,
    textAlign: 'center',
  },
  markDescription: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: '#9B8B7A',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 28,
  },
  actions: {
    alignItems: 'center',
    gap: 14,
  },
  pinButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  pinButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  maybeLaterText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: '#9B8B7A',
  },
  dismissButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  dismissButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
