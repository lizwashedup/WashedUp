import React, { useMemo } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Search, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { SEARCH } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';

/**
 * Persistent search field at the top of the People hub. Controlled by the
 * hub so it can swap the grid for results while typing.
 */
export default function PeopleSearchBar({
  value,
  onChange,
  appearance,
}: {
  value: string;
  onChange: (next: string) => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const s = useMemo(() => appearance ? { ...styles, ...searchAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const iconColor = appearance ? AfterglowColors.muted : Colors.tertiary;
  return (
    <View style={s.wrap}>
      <Search size={SEARCH.iconSize} color={iconColor} />
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={COPY.searchPlaceholder}
        placeholderTextColor={iconColor}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={COPY.searchPlaceholder}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          style={appearance ? s.clear : undefined}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X size={SEARCH.iconSize} color={iconColor} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {},
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

function searchAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  wrap: { ...styles.wrap, minHeight: 48, height: undefined, borderRadius: 4,
    backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, paddingRight: 4 },
  input: { ...styles.input, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink,
    minWidth: 0, minHeight: 44, paddingVertical: 10 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
}); }
