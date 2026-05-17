import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';

export type YoursTab = 'people' | 'albums';

/** Full-width underline tabs (active: asphalt + terracotta underline). */
export default function YoursTabs({
  active,
  onChange,
}: {
  active: YoursTab;
  onChange: (t: YoursTab) => void;
}) {
  return (
    <View style={styles.row}>
      {(
        [
          ['people', COPY.tabPeople],
          ['albums', COPY.tabAlbums],
        ] as const
      ).map(([key, label]) => {
        const on = active === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{label}</Text>
            {on && <View style={styles.underline} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 4 },
  tab: { marginRight: 24, paddingVertical: 8 },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.tertiary,
  },
  labelOn: { color: Colors.asphalt, fontFamily: Fonts.sansBold },
  underline: {
    height: 2.5,
    backgroundColor: Colors.terracotta,
    borderRadius: 2,
    marginTop: 6,
  },
});
