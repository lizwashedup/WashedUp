import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Image } from 'expo-image';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import type { YoursGridPerson } from '../../../lib/yours/types';
import { COPY } from '../state/constants';

/** One selection target owns the photo, name, and checkbox. Activity rings are not selection state. */
export default function InvitationPerson({ person, selected, confirmed, disabled, inline, onPress }: {
  person: YoursGridPerson;
  selected: boolean;
  confirmed: boolean;
  disabled: boolean;
  inline?: boolean;
  onPress: () => void;
}) {
  const name = person.first_name_display?.trim() || person.handle || COPY.pingPerson;
  const size = inline ? 52 : 44;
  return (
    <Pressable style={inline ? styles.inline : styles.row} onPress={onPress} disabled={disabled || confirmed}
      accessibilityRole="checkbox" accessibilityLabel={confirmed ? COPY.pingPersonConfirmed(name) : name}
      accessibilityState={{ checked: selected || confirmed, disabled: disabled || confirmed }}
      aria-checked={selected || confirmed} aria-disabled={disabled || confirmed}>
      <View style={[styles.photo, { width: size, height: size, borderRadius: size / 2 }]}
        pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        {person.profile_photo_url
          ? <Image source={{ uri: person.profile_photo_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" accessible={false} />
          : <Text style={styles.initial} accessible={false}>{Array.from(name)[0].toUpperCase()}</Text>}
      </View>
      <Text style={[styles.name, inline && styles.inlineName]} numberOfLines={2}>{name}</Text>
      <View style={[styles.checkbox, inline && styles.inlineCheckbox, (selected || confirmed) && styles.checked]}>
        {(selected || confirmed) && <Check size={14} color={Colors.white} strokeWidth={2.5} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inline: { width: 76, minHeight: 92, alignItems: 'center', paddingTop: 4, marginRight: 8, gap: 8 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  photo: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.inputBg },
  initial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.secondary },
  name: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  inlineName: { flex: 0, textAlign: 'center', fontSize: FontSizes.bodySM },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.tertiary, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  inlineCheckbox: { position: 'absolute', right: 6, top: 2 },
  checked: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
});
