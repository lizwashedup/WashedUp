/**
 * EditorialTitleField - the plan title as a name, not a form field. Cormorant
 * italic ~28px on a single underline rule, no border box (design study v3).
 * Shared by both composer surfaces (PlanComposerV2 + CirclePlanComposer).
 */
import { StyleSheet, Text, TextInput, View } from 'react-native';

import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';

interface EditorialTitleFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  label?: string;
  maxLength?: number;
  autoFocus?: boolean;
}

export default function EditorialTitleField({
  value,
  onChangeText,
  placeholder,
  label = 'what',
  maxLength = 80,
  autoFocus = false,
}: EditorialTitleFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.inkSoft}
        maxLength={maxLength}
        autoFocus={autoFocus}
        returnKeyType="next"
        multiline={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  label: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.terracotta,
    marginBottom: 8,
  },
  input: {
    fontFamily: Fonts.displayItalic,
    fontSize: 28,
    lineHeight: 32,
    color: Colors.darkWarm,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingBottom: 6,
    paddingTop: 0,
  },
});
