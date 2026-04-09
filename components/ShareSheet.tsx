import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Share,
} from 'react-native';
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
  const deepLink = slug ? `https://washedup.app/plans/${slug}` : `https://washedup.app/e/${planId}`;

  const handleSendToFriend = () => {
    hapticLight();
    onClose();
    router.push('/(tabs)/friends' as any);
  };

  const handleCopyLink = async () => {
    hapticLight();
    // Use Share API as clipboard fallback — avoids needing native expo-clipboard rebuild
    await Share.share({ message: deepLink });
    onClose();
  };

  const handleShareVia = async () => {
    hapticLight();
    onClose();
    setTimeout(() => {
      Share.share({
        message: `${planTitle}\n${deepLink}`,
      });
    }, 300);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share this plan</Text>

          <TouchableOpacity style={styles.option} onPress={handleSendToFriend} activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="people-outline" size={20} color="#B5522E" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Send to a friend on washedup</Text>
              <Text style={styles.optionSub}>Pick from your People list</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#A09385" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.option} onPress={handleCopyLink} activeOpacity={0.7}>
            <View style={styles.iconWrap}>
              <Ionicons name="link-outline" size={20} color="#B5522E" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Copy link</Text>
              <Text style={styles.optionSub}>{deepLink}</Text>
            </View>
            <Ionicons name="copy-outline" size={16} color="#A09385" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.option} onPress={handleShareVia} activeOpacity={0.7}>
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
