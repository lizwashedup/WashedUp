import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AlbumsGrid } from '../../albums/AlbumsGrid';
import AvatarGrid from '../grid/AvatarGrid';
import type { YoursTab } from '../header/YoursTabs';
import type { AnchorRect } from '../../menu/MenuCard';
import type { YoursGridPerson } from '../../../lib/yours/types';

/** Populated state body. Header + tabs are sticky in YoursScreen. */
export default function PopulatedView({
  userId,
  activeTab,
  people,
  lightUpIds,
  onAdd,
  onPressPerson,
  onLongPressPerson,
  onPressPill,
}: {
  userId: string;
  activeTab: YoursTab;
  people: YoursGridPerson[];
  lightUpIds: Set<string>;
  onAdd: () => void;
  onPressPerson: (p: YoursGridPerson) => void;
  onLongPressPerson: (p: YoursGridPerson, rect: AnchorRect) => void;
  onPressPill: (p: YoursGridPerson) => void;
}) {
  if (activeTab === 'albums') {
    return (
      <View style={styles.fill}>
        <AlbumsGrid userId={userId} />
      </View>
    );
  }
  return (
    <AvatarGrid
      people={people}
      lightUpIds={lightUpIds}
      onAdd={onAdd}
      onPressPerson={onPressPerson}
      onLongPressPerson={onLongPressPerson}
      onPressPill={onPressPill}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
