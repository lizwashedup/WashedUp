/**
 * PeoplePickerSheet - a plain multiselect over your people, used by the composer's
 * "+ Add from your people" affordance (the pull half of the reactance fix). Unlike
 * AddPeopleSheet this has NO circle and calls no invite RPC: it just returns the
 * picked people so the composer turns them into invite chips. Excludes anyone
 * already a chip on the plan.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, FlatList, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useAuthUserId } from '../yours/state/useAuthUserId';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import { usePickerFilter } from '../../hooks/usePickerFilter';
import PeopleSearchBar from '../yours/search/PeopleSearchBar';
import type { YoursGridPerson } from '../../lib/yours/types';

export interface PickedPerson {
  user_id: string;
  name: string;
  photo: string | null;
}

const AVATAR = 44;
const CHECK = 24;

function PickRow({ person, selected, onToggle }: { person: YoursGridPerson; selected: boolean; onToggle: () => void }) {
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  return (
    <Pressable
      onPress={() => { hapticSelection(); onToggle(); }}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      {person.profile_photo_url ? (
        <Image source={{ uri: person.profile_photo_url }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.initial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Check size={16} color={Colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

export default function PeoplePickerSheet({
  visible,
  excludeIds,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  excludeIds: string[];
  onClose: () => void;
  onConfirm: (picked: PickedPerson[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { data: userId } = useAuthUserId();
  const { data: people = [], isLoading } = useYoursGrid(userId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pickable = useMemo(() => {
    const present = new Set(excludeIds);
    return people.filter((p) => !present.has(p.user_id));
  }, [people, excludeIds]);

  // Search appears only past the threshold; selected people stay visible even
  // when they fall outside the current query.
  const { query, setQuery, showSearch, filtered } = usePickerFilter(
    pickable,
    (p) => selected.has(p.user_id),
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const close = () => { setSelected(new Set()); onClose(); };

  const confirm = () => {
    const picked: PickedPerson[] = pickable
      .filter((p) => selected.has(p.user_id))
      .map((p) => ({
        user_id: p.user_id,
        name: p.first_name_display?.trim() || p.handle?.trim() || 'Someone',
        photo: p.profile_photo_url,
      }));
    setSelected(new Set());
    onConfirm(picked);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={close} accessibilityLabel={COPY.circlePlusCancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{COPY.peoplePickerTitle}</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel}>
              <X size={22} color={Colors.secondary} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.center}><ActivityIndicator color={Colors.terracotta} /></View>
          ) : pickable.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>{COPY.peoplePickerEmptyTitle}</Text>
              <Text style={styles.emptySub}>{COPY.peoplePickerEmptySub}</Text>
            </View>
          ) : (
            <>
              {showSearch && <PeopleSearchBar value={query} onChange={setQuery} />}
              <FlatList
                data={filtered}
                keyExtractor={(p) => p.user_id}
                renderItem={({ item }) => (
                  <PickRow person={item} selected={selected.has(item.user_id)} onToggle={() => toggle(item.user_id)} />
                )}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            </>
          )}

          {pickable.length > 0 && (
            <Pressable
              onPress={confirm}
              disabled={selected.size === 0}
              style={[styles.cta, selected.size === 0 && styles.ctaDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: selected.size === 0 }}
              accessibilityLabel={COPY.peoplePickerConfirm(selected.size)}
            >
              <Text style={styles.ctaLabel}>{COPY.peoplePickerConfirm(selected.size)}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropTap: { flex: 1 },
  sheet: { backgroundColor: Colors.parchment, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, maxHeight: '80%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  center: { paddingVertical: 48, paddingHorizontal: 40, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary, textAlign: 'center', marginTop: 8 },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 14 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: Colors.inputBg },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brandSoft },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  name: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  check: { width: CHECK, height: CHECK, borderRadius: CHECK / 2, borderWidth: 1.5, borderColor: Colors.borderWarm, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  cta: { backgroundColor: Colors.terracotta, borderRadius: 999, marginHorizontal: 20, marginTop: 8, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
