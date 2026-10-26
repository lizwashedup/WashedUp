import React, { useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Share,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { hapticLight } from '../lib/haptics';
import { useRouter } from 'expo-router';

interface Props {
  visible: boolean;
  planId: string;
  planTitle: string;
  slug?: string | null;
  onClose: () => void;
}

export function ShareSheet({ visible, planId, planTitle, slug, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deepLink = slug ? `https://washedup.app/plans/${slug}` : `https://washedup.app/e/${planId}`;

  const focused = useIsFocused();
  const [closing, setClosing] = useState(false);
  const active = useRef(false);
  const busy = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    active.current = focused;
    busy.current = false;
    pending.current = null;
    setClosing(false);
    return () => { active.current = false; pending.current = null; };
  }, [focused, visible, planId]);

  const finishDismissal = () => {
    const next = pending.current;
    pending.current = null;
    if (active.current) next?.();
  };
  const closeThen = (next?: () => void) => {
    if (!visible || !active.current || busy.current) return;
    busy.current = true;
    pending.current = () => { onClose(); next?.(); };
    setClosing(true);
    if (Platform.OS !== 'ios') finishDismissal();
  };
  const share = (message: string) => {
    // The native sheet may reject (for example if its presenter disappeared).
    // Handle it without an unhandled promise or a second automatic dispatch.
    void Share.share({ message }).catch(() => {
      if (active.current) Alert.alert('Couldn’t share', 'Please open Share and try again.');
    });
  };
  const handleSendToFriend = () => {
    hapticLight();
    closeThen(() => router.push('/(tabs)/friends?tab=people' as any));
  };
  const handleCopyLink = () => {
    hapticLight();
    // Preserve the existing link-only native share fallback.
    closeThen(() => share(deepLink));
  };
  const handleShareVia = () => {
    hapticLight();
    closeThen(() => share(`${planTitle}\n${deepLink}`));
  };

  return (
    <Modal visible={visible && focused && !closing} transparent animationType="slide" onRequestClose={() => closeThen()} onDismiss={finishDismissal} statusBarTranslucent>
      <Pressable accessible={false} style={styles.overlay} onPress={() => closeThen()}>
        <Pressable accessible={false} accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(40, insets.bottom + 16) }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share this plan</Text>

          <TouchableOpacity style={styles.option} onPress={handleSendToFriend} disabled={closing} accessibilityRole="button" accessibilityLabel="Send to one of your people" activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="people-outline" size={20} color="#B5522E" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Send to one of your people</Text>
              <Text style={styles.optionSub}>Pick from your People list</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#A09385" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.option} onPress={handleCopyLink} disabled={closing} accessibilityRole="button" accessibilityLabel="Copy link" activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="link-outline" size={20} color="#B5522E" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Copy link</Text>
              <Text style={styles.optionSub}>{deepLink}</Text>
            </View>
            <Ionicons name="copy-outline" size={16} color="#A09385" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.option} onPress={handleShareVia} disabled={closing} accessibilityRole="button" accessibilityLabel="Share via" activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="share-outline" size={20} color="#B5522E" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Share via...</Text>
              <Text style={styles.optionSub}>Messages, WhatsApp, Instagram & more</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#A09385" />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(44, 24, 16, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FAF5EC',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D5CCC2',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2C1810',
    marginBottom: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    gap: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5E8E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C1810',
  },
  optionSub: {
    fontSize: 12,
    color: '#78695C',
  },
});
