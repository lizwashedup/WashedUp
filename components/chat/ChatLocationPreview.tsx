import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { chatLocationLabel, type ChatLocation } from '../../lib/chatLocation';

interface Props {
  location: ChatLocation | null;
  fonts: AfterglowFontFamilies;
  isOwn: boolean;
}

/** Content of the existing tappable message. Its parent still owns map routing,
 * long-press actions and room access. No map request or location lookup here. */
export function ChatLocationPreview({ location, fonts, isOwn }: Props) {
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const tint = isOwn ? Colors.white : Colors.clay;
  return (
    <View style={styles.row}>
      <View style={styles.pin} accessible={false}>
        <Ionicons name="location-outline" size={22} color={tint} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.address, isOwn && styles.own]} numberOfLines={3}>
          {location ? chatLocationLabel(location) : 'Location unavailable'}
        </Text>
        <Text style={[styles.hint, isOwn && styles.own]}>
          {location ? 'Shared pin · Open map' : 'Ask for a new pin'}
        </Text>
      </View>
      {location && <Ionicons name="arrow-forward" size={18} color={tint} accessible={false} />}
    </View>
  );
}

const createStyles = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, maxWidth: '100%' },
  pin: { alignSelf: 'flex-start', paddingTop: 4 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  address: { ...AfterglowType.body, fontFamily: fonts.medium, color: Colors.ink },
  hint: { ...AfterglowType.caption, fontFamily: fonts.regular, color: Colors.muted },
  own: { color: Colors.white },
});
