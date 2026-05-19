import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronRight, AtSign, QrCode } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import BottomSheet from '../primitives/BottomSheet';
import PlanHistoryBacklog from './PlanHistoryBacklog';
import HandleLookupView from './HandleLookupView';
import QRShareView from './QRShareView';
import { COPY } from '../state/constants';
import { useReferral } from '../../../hooks/useReferral';
import { openInviteComposer } from '../../../lib/yours/invite';

type Mode = 'menu' | 'plans' | 'handle' | 'qr';

/** The add entry point: four doorways, then full-screen list/handle/QR. */
export default function PathsSheet({
  visible,
  onClose,
  userId,
  backlogCount,
  onPressPerson,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  backlogCount: number;
  onPressPerson: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const { ensureReferralCode } = useReferral();

  const invite = async () => {
    try {
      const code = await ensureReferralCode(userId);
      await openInviteComposer(code);
    } catch {
      Alert.alert('', "Couldn't open your invite just now. Try again.");
    }
  };

  const close = () => {
    setMode('menu');
    onClose();
  };

  if (mode !== 'menu') {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setMode('menu')}>
        <SafeAreaView style={styles.full}>
          <Pressable
            style={styles.close}
            onPress={() => setMode('menu')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <X size={24} color={Colors.asphalt} />
          </Pressable>
          <View style={styles.fullBody}>
            {mode === 'plans' ? (
              <PlanHistoryBacklog
                userId={userId}
                onPressPerson={onPressPerson}
              />
            ) : mode === 'qr' ? (
              <QRShareView userId={userId} />
            ) : (
              <HandleLookupView
                userId={userId}
                onPressPerson={onPressPerson}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View style={styles.menu}>
        <Pressable
          style={[styles.card, styles.cardPrimary]}
          onPress={() => setMode('plans')}
        >
          <Text style={styles.cardTitle}>{COPY.pathPlansTitle}</Text>
          <Text style={styles.count}>
            {backlogCount} people <ChevronRight size={16} color={Colors.terracotta} />
          </Text>
        </Pressable>

        <Pressable style={styles.card} onPress={invite}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{COPY.pathInviteTitle}</Text>
            <Text style={styles.cardSub}>{COPY.pathInviteSub}</Text>
          </View>
          <ChevronRight size={18} color={Colors.tertiary} />
        </Pressable>

        <Pressable style={styles.card} onPress={() => setMode('handle')}>
          <Text style={styles.cardTitle}>{COPY.pathSearchTitle}</Text>
          <AtSign size={18} color={Colors.terracotta} />
        </Pressable>

        <Pressable style={styles.card} onPress={() => setMode('qr')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{COPY.pathQRTitle}</Text>
            <Text style={styles.cardSub}>{COPY.pathQRSub}</Text>
          </View>
          <QrCode size={18} color={Colors.terracotta} />
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  menu: { gap: 12, paddingBottom: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.cream,
    borderRadius: 16,
    padding: 16,
  },
  cardPrimary: { paddingVertical: 22 },
  cardTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  cardSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  count: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.terracotta,
  },
  full: { flex: 1, backgroundColor: Colors.parchment },
  close: { alignSelf: 'flex-end', padding: 16 },
  fullBody: { flex: 1, paddingHorizontal: 16 },
});
