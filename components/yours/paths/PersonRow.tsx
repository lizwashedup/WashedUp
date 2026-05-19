import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';

/** Shared backlog / search result row. */
export default function PersonRow({
  name,
  photoUrl,
  sharedCount,
  state,
  onAdd,
  onPressPerson,
}: {
  name: string | null;
  photoUrl: string | null;
  sharedCount: number;
  /** 'none' shows Add; 'requested' shows Requested; 'connected' hides CTA. */
  state: 'none' | 'requested' | 'incoming' | 'connected';
  onAdd: () => void;
  onPressPerson: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPressPerson}>
      <YoursAvatar
        name={name}
        photoUrl={photoUrl}
        size={48}
        bucket="none"
      />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>
          {name ?? 'Someone'}
        </Text>
        {sharedCount > 0 && (
          <Text style={styles.meta}>
            {COPY.backlogPlansTogether(sharedCount)}
          </Text>
        )}
      </View>
      {state === 'none' ? (
        <Pressable
          style={styles.addBtn}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={`${COPY.addButton} ${name ?? ''}`}
        >
          <Text style={styles.addText}>{COPY.addButton}</Text>
        </Pressable>
      ) : state === 'requested' ? (
        <Text style={styles.requested}>{COPY.stateRequested}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  mid: { flex: 1 },
  name: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  requested: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },
});
