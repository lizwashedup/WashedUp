import React, { useCallback } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import AvatarGridCell from './AvatarGridCell';
import type { YoursGridPerson } from '../../../lib/yours/types';

/**
 * 3-column virtualized avatar grid. Header (banner/sort) is passed in so
 * it scrolls with content; the sticky page header/tabs live outside.
 */
export default function AvatarGrid({
  people,
  lightUpIds,
  header,
  onPressPerson,
  onLongPressPerson,
  onPressPill,
}: {
  people: YoursGridPerson[];
  lightUpIds: Set<string>;
  header?: React.ReactElement | null;
  onPressPerson: (p: YoursGridPerson) => void;
  onLongPressPerson: (p: YoursGridPerson) => void;
  onPressPill: (p: YoursGridPerson) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: YoursGridPerson }) => (
      <AvatarGridCell
        person={item}
        lightUp={lightUpIds.has(item.user_id)}
        onPress={() => onPressPerson(item)}
        onLongPress={() => onLongPressPerson(item)}
        onPressPill={() => onPressPill(item)}
      />
    ),
    [lightUpIds, onPressPerson, onLongPressPerson, onPressPill],
  );

  return (
    <FlatList
      data={people}
      keyExtractor={(p) => p.user_id}
      numColumns={3}
      renderItem={renderItem}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      windowSize={5}
      initialNumToRender={12}
      removeClippedSubviews
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { justifyContent: 'space-between' },
});
