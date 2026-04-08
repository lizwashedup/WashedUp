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
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

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
    hapticLight();
    try {
      await Share.share({
        message: shareMessage ?? shareUrl,
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
              <Share2 size={18} color={Colors.white} strokeWidth={2} />
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
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
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
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    marginRight: 8,
  },
  listItem: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  encouragement: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
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
    backgroundColor: Colors.terracotta,
    paddingVertical: 14,
    borderRadius: 14,
  },
  shareButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  doneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.terracotta,
  },
  doneButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.terracotta,
  },
});
