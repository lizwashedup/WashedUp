import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import AvatarGridCell from './AvatarGridCell';
import AddGridCell from './AddGridCell';
import type { YoursGridPerson } from '../../../lib/yours/types';

/** First grid slot is the in-page "add" affordance, then the people. */
const ADD_ITEM = { __add: true } as const;
type GridItem = typeof ADD_ITEM | YoursGridPerson;
const isAdd = (i: GridItem): i is typeof ADD_ITEM =>
  (i as { __add?: true }).__add === true;

/**
 * 3-column virtualized avatar grid. Header (banner/sort) is passed in so
 * it scrolls with content; the sticky page header/tabs live outside. The
 * add-people entry point is the first grid cell (spec: in-page, part of
 * the grid — not a header or floating button).
 */
export default function AvatarGrid({
  people,
  lightUpIds,
  header,
  onAdd,
  onPressPerson,
  onLongPressPerson,
  onPressPill,
}: {
  people: YoursGridPerson[];
  lightUpIds: Set<string>;
  header?: React.ReactElement | null;
  onAdd: () => void;
  onPressPerson: (p: YoursGridPerson) => void;
  onLongPressPerson: (p: YoursGridPerson) => void;
  onPressPill: (p: YoursGridPerson) => void;
}) {
  const data = useMemo<GridItem[]>(() => [ADD_ITEM, ...people], [people]);

  const renderItem = useCallback(
    ({ item }: { item: GridItem }) =>
      isAdd(item) ? (
        <AddGridCell onPress={onAdd} />
      ) : (
        <AvatarGridCell
          person={item}
          lightUp={lightUpIds.has(item.user_id)}
          onPress={() => onPressPerson(item)}
          onLongPress={() => onLongPressPerson(item)}
          onPressPill={() => onPressPill(item)}
        />
      ),
    [onAdd, lightUpIds, onPressPerson, onLongPressPerson, onPressPill],
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => (isAdd(item) ? '__add' : item.user_id)}
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
