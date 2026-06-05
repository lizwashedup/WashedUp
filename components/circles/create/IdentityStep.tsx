/**
 * IdentityStep - step 1 of the create-circle flow: name (required) + an
 * optional description, with a live monogram cover preview. Cover-photo upload
 * is deferred (the cover_upload_id origin is undefined in v1; circles use the
 * monogram cover), so there is no photo picker here yet.
 */
import React from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_CREATE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import CircleCover from '../../yours/circles/CircleCover';

export default function IdentityStep({
  name,
  description,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  onName: (t: string) => void;
  onDescription: (t: string) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.coverWrap}>
        <CircleCover
          name={name}
          coverUrl={null}
          size={CIRCLE_CREATE.coverPreview}
          radius={CIRCLE_CREATE.coverPreviewRadius}
          monogramSize={CIRCLE_CREATE.coverMonogram}
        />
      </View>
      <Text style={styles.title}>{COPY.circleStep1Title}</Text>
      <TextInput
        style={styles.field}
        value={name}
        onChangeText={onName}
        placeholder={COPY.circleNamePlaceholder}
        placeholderTextColor={Colors.tertiary}
        maxLength={60}
        autoFocus
        returnKeyType="next"
      />
      <TextInput
        style={[styles.field, styles.desc]}
        value={description}
        onChangeText={onDescription}
        placeholder={COPY.circleDescPlaceholder}
        placeholderTextColor={Colors.tertiary}
        multiline
        maxLength={140}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, alignItems: 'stretch' },
  coverWrap: { alignItems: 'center', marginBottom: 20 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginBottom: 20,
  },
  field: {
    backgroundColor: Colors.inputBg,
    borderRadius: CIRCLE_CREATE.fieldRadius,
    minHeight: CIRCLE_CREATE.fieldMinHeight,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  desc: { minHeight: CIRCLE_CREATE.descMinHeight, textAlignVertical: 'top' },
});
