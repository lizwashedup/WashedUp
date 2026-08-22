/**
 * PlanChooserSheet — inventory PL-01: the real chooser step between an event
 * and a Plan. Shown when "find people to go with" is tapped (or a post-RSVP
 * nudge fires) and one or more open Plans already exist for the event, so
 * the person picks a real group instead of a hidden first-match or a skip-
 * straight-to-creation form. Same sheet chrome as PeoplePickerSheet.
 */
import React from 'react';
import { View, Text, Modal, Pressable, FlatList, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export interface ChooserPlan {
  id: string;
  title: string;
  creator_name: string | null;
  creator_photo: string | null;
  spotsText: string;
  isFull: boolean;
}

function PlanRow({ plan, onPress }: { plan: ChooserPlan; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={plan.title}>
      {plan.creator_photo ? (
        <Image source={{ uri: plan.creator_photo }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.initial}>{plan.creator_name?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{plan.title}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{plan.creator_name ?? 'someone'} · {plan.spotsText}</Text>
      </View>
      <View style={[styles.joinBtn, plan.isFull && styles.joinBtnFull]}>
        <Text style={[styles.joinBtnText, plan.isFull && styles.joinBtnTextFull]}>
          {plan.isFull ? 'full' : 'join'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function PlanChooserSheet({
  visible,
  plans,
  onSelectPlan,
  onStartNew,
  onClose,
}: {
  visible: boolean;
  plans: ChooserPlan[];
  onSelectPlan: (planId: string) => void;
  onStartNew: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} accessibilityLabel="close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.headerRow}>
            {/* the lowercase law */}
            <Text style={styles.title}>join a group, or start your own</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="close">
              <X size={22} color={Colors.secondary} />
            </Pressable>
          </View>
          <FlatList
            data={plans}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => <PlanRow plan={item} onPress={() => onSelectPlan(item.id)} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          <Pressable onPress={onStartNew} style={styles.cta} accessibilityRole="button" accessibilityLabel="start a new plan">
            {/* copy to the taste gate */}
            <Text style={styles.ctaLabel}>start a new plan</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
  backdropTap: { flex: 1 },
  sheet: { backgroundColor: Colors.parchment, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, maxHeight: '80%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8, gap: 12 },
  title: { flex: 1, fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.inputBg },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  rowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
  joinBtn: { borderRadius: 999, borderWidth: 1.5, borderColor: Colors.terracotta, paddingHorizontal: 12, paddingVertical: 6 },
  joinBtnFull: { borderColor: Colors.borderWarm },
  joinBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  joinBtnTextFull: { color: Colors.secondary },
  cta: { backgroundColor: Colors.terracotta, borderRadius: 999, marginHorizontal: 20, marginTop: 8, paddingVertical: 15, alignItems: 'center' },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
