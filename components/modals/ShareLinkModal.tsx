import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Share,
} from 'react-native';
import { Share2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const SHARE_EXAMPLES = [
  'Instagram Stories or DMs',
  'Bumble BFF conversations',
  'Text messages & group chats',
  'Reddit (r/LosAngeles, r/LAlist, r/MakeFriendsInLA)',
  'Facebook groups',
  'Discord communities',
];

export interface ShareLinkModalProps {
  visible: boolean;
  onClose: () => void;
  shareUrl: string;
  shareTitle?: string;
  shareMessage?: string;
}

export function ShareLinkModal({
  visible,
  onClose,
  shareUrl,
  shareTitle = 'Share this plan',
  shareMessage,
}: ShareLinkModalProps) {
  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: shareMessage ?? `Join me on WashedUp!\n${shareUrl}`,
        title: shareTitle,
        url: shareUrl,
      });
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Where to share your link:</Text>
          <Text style={styles.subtitle}>Post it wherever people already are:</Text>

          <View style={styles.list}>
            {SHARE_EXAMPLES.map((item, i) => (
              <View key={i} style={styles.listRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.listItem}>{item}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.encouragement}>
            The more places you share, the faster it fills up!
          </Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.85}>
              <Share2 size={18} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneButton} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  list: {
    marginBottom: 16,
  },
  listRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bullet: {
    fontSize: 14,
    color: '#666666',
    marginRight: 8,
  },
  listItem: {
    flex: 1,
    fontSize: 14,
    color: '#666666',
  },
  encouragement: {
    fontSize: 15,
    fontWeight: '600',
    color: '#C4652A',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#C4652A',
    paddingVertical: 14,
    borderRadius: 14,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  doneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C4652A',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#C4652A',
  },
});
