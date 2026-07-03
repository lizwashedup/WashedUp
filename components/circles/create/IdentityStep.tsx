/**
 * IdentityStep - the Name step of the create-circle flow: name (required) and
 * optional description lead; the optional cover affordance sits below, with a
 * preview only once a photo is actually picked (no empty ghost tile). The
 * cover is skippable and never blocks Next; it uploads after the circle
 * exists (useCreateCircle).
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { ImagePlus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_CREATE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import CircleCover from '../../yours/circles/CircleCover';

export default function IdentityStep({
  name,
  description,
  coverPreviewUri,
  onName,
  onDescription,
  onPickCover,
}: {
  name: string;
  description: string;
  coverPreviewUri: string | null;
  onName: (t: string) => void;
  onDescription: (t: string) => void;
  onPickCover: () => void;
}) {
  const [coverPressed, setCoverPressed] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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
      <View style={styles.coverWrap}>
        {!!coverPreviewUri && (
          <CircleCover
            name={name}
            coverUrl={coverPreviewUri}
            size={CIRCLE_CREATE.coverPreview}
            radius={CIRCLE_CREATE.coverPreviewRadius}
            monogramSize={CIRCLE_CREATE.coverMonogram}
          />
        )}
        <Pressable
          onPress={onPickCover}
          onPressIn={() => setCoverPressed(true)}
          onPressOut={() => setCoverPressed(false)}
          android_ripple={{ color: Colors.border }}
          style={[styles.coverBtn, coverPressed && styles.coverBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={coverPreviewUri ? COPY.circleCoverChange : COPY.circleCoverAdd}
        >
          <ImagePlus size={16} color={Colors.terracotta} strokeWidth={1.75} />
          <Text style={styles.coverBtnText}>
            {coverPreviewUri ? COPY.circleCoverChange : COPY.circleCoverAdd}
          </Text>
        </Pressable>
        {!coverPreviewUri && <Text style={styles.coverSub}>{COPY.circleCoverSub}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, alignItems: 'stretch' },
  coverWrap: { alignItems: 'center', marginTop: 16, gap: 12 },
  coverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  coverBtnPressed: { opacity: 0.7 },
  coverBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  coverSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    maxWidth: 260,
  },
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
