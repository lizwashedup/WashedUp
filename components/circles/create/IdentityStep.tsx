/**
 * IdentityStep - the Name step of the create-circle flow: name (required) and
 * optional description lead; the optional cover affordance sits below, with a
 * preview only once a photo is actually picked (no empty ghost tile). The
 * cover is skippable and never blocks Next; it uploads after the circle
 * exists (useCreateCircle).
 */
import React, { useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
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
  appearance,
  picking = false,
  pickError = null,
}: {
  name: string;
  description: string;
  coverPreviewUri: string | null;
  onName: (t: string) => void;
  onDescription: (t: string) => void;
  onPickCover: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
  picking?: boolean;
  pickError?: string | null;
}) {
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const descriptionInput = useRef<TextInput>(null);
  const coverLabel = appearance ? (coverPreviewUri ? 'Change photo' : 'Add photo') : (coverPreviewUri ? COPY.circleCoverChange : COPY.circleCoverAdd);
  const [coverPressed, setCoverPressed] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={styled.wrap}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styled.title}>{COPY.circleStep1Title}</Text>
      {appearance && <Text style={styled.label}>Name (required)</Text>}
      <TextInput
        accessibilityLabel="Circle name, required"
        style={styled.field}
        value={name}
        onChangeText={onName}
        placeholder={COPY.circleNamePlaceholder}
        placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
        maxLength={60}
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => descriptionInput.current?.focus()}
        blurOnSubmit={false}
      />
      {appearance && <Text style={styled.label}>Description (optional)</Text>}
      <TextInput
        ref={descriptionInput}
        accessibilityLabel="Description, optional"
        style={[styled.field, styled.desc]}
        value={description}
        onChangeText={onDescription}
        placeholder={COPY.circleDescPlaceholder}
        placeholderTextColor={appearance ? AfterglowColors.muted : Colors.tertiary}
        multiline
        maxLength={140}
      />
      <View style={styled.coverWrap}>
        {!!coverPreviewUri && (appearance ? <CoverPreview key={coverPreviewUri} uri={coverPreviewUri} name={name} appearance={appearance}/> :
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
          disabled={picking}
          accessibilityState={{ disabled: picking, busy: picking }}
          onPressIn={() => setCoverPressed(true)}
          onPressOut={() => setCoverPressed(false)}
          android_ripple={{ color: Colors.border }}
          style={[styled.coverBtn, coverPressed && styled.coverBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={picking ? 'Opening photos…' : coverLabel}
        >
          <ImagePlus size={18} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={1.75}/>
          {picking && <ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta}/>}
          <Text numberOfLines={1} style={styled.coverBtnText}>
            {picking ? 'Opening photos…' : coverLabel}
          </Text>
        </Pressable>
        {!coverPreviewUri && <Text style={styled.coverSub}>{appearance ? 'Optional. Shared photos can become your circle’s cover later.' : COPY.circleCoverSub}</Text>}
        {pickError && <Text accessibilityRole="alert" style={styled.error}>{pickError}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: {}, error: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed },
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

function CoverPreview({ uri, name, appearance }: { uri: string; name: string; appearance: { fonts: AfterglowFontFamilies } }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ width: '100%', aspectRatio: 1.6, backgroundColor: AfterglowColors.avatar, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
    {failed ? <CircleCover name={name} size={100} radius={4} monogramSize={AfterglowType.identity.fontSize} appearance={appearance}/> : <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" onError={() => setFailed(true)} accessibilityLabel="Selected circle photo"/>}
  </View>;
}
function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, marginBottom: 24 },
  label: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 8 },
  field: { ...styles.field, ...AfterglowType.message, fontFamily: fonts.regular, color: AfterglowColors.ink, backgroundColor: AfterglowColors.white, borderRadius: 4, borderWidth: 1, borderColor: AfterglowColors.line, marginBottom: 20 },
  coverWrap: { alignItems: 'center', marginTop: 0, gap: 12 },
  coverBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: 4, borderColor: AfterglowColors.clay },
  coverBtnText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  coverSub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center' },
  error: { ...AfterglowType.body, fontFamily: fonts.regular, color: Colors.errorRed },
}); }
