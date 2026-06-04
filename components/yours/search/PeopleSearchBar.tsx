import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Search, X } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { SEARCH } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';

/**
 * Persistent search field at the top of the People hub. Controlled by the
 * hub so it can swap the grid for results while typing.
 */
export default function PeopleSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Search size={SEARCH.iconSize} color={Colors.tertiary} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={COPY.searchPlaceholder}
        placeholderTextColor={Colors.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={COPY.searchPlaceholder}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X size={SEARCH.iconSize} color={Colors.tertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: SEARCH.fieldHeight,
    borderRadius: SEARCH.fieldRadius,
    backgroundColor: Colors.creamWarm,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    paddingHorizontal: 12,
    marginHorizontal: SEARCH.horizontalInset,
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    padding: 0,
  },
});
