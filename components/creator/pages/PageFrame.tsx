import { ScaledText } from '../../ScaledText';
import ProfileButton from '../../ProfileButton';
import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CreatorActionFill } from '../CreatorActionFill';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import Colors, { AfterglowColors as C, CreatorSurfaceColors } from '../../../constants/Colors';
import { AfterglowType as T, FontSizes, LineHeights } from '../../../constants/Typography';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';

export function PageAction({ title, onPress, disabled, primary = false, quiet = false, compact = false, disclosure = false, singleLine = false, accessibilityLabel, leadingIcon, sunset = primary }: {
  title: string; onPress: () => void; disabled?: boolean; primary?: boolean; quiet?: boolean; compact?: boolean; disclosure?: boolean; singleLine?: boolean; accessibilityLabel?: string; leadingIcon?: React.ReactNode; sunset?: boolean;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, primary && s.primary, compact && s.compact, quiet && s.quiet, disclosure && s.disclosure, sunset && primary && s.sunset, sunset && primary && !!leadingIcon && s.sunsetWithIcon, pressed && sunset && s.sunsetPressed, disabled && s.disabled]}>
    {sunset && primary && <CreatorActionFill />}
    <View style={[s.actionContent, disclosure && s.disclosureContent]}>
      {leadingIcon && <View style={s.leadingIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{leadingIcon}</View>}
      <ScaledText numberOfLines={singleLine ? 1 : undefined} adjustsFontSizeToFit={singleLine} minimumFontScale={0.9} style={[s.actionText, compact && s.compactText, disclosure && s.disclosureText, { fontFamily: fonts.medium, color: primary ? Colors.white : quiet && !disclosure ? Colors.terracotta : C.ink }]}>{title}</ScaledText>
    </View>
    {disclosure && <ChevronRight size={17} color={C.muted} />}
  </Pressable>;
}
export function PageFrame({ children, title = 'Your page', footer, busy, onBack, contentKey, onRefresh, refreshing = false, scrollRef, onContentSizeChange, onViewportLayout, onScrollBeginDrag, innerViewRef }: {
  children: React.ReactNode; title?: string; footer?: React.ReactNode; busy?: boolean; onBack?: () => void; contentKey?: string; onRefresh?: () => void; refreshing?: boolean;
  scrollRef?: React.Ref<ScrollView>;
  innerViewRef?: React.ComponentProps<typeof ScrollView>['innerViewRef'];
  onContentSizeChange?: React.ComponentProps<typeof ScrollView>['onContentSizeChange'];
  onViewportLayout?: React.ComponentProps<typeof ScrollView>['onLayout'];
  onScrollBeginDrag?: React.ComponentProps<typeof ScrollView>['onScrollBeginDrag'];
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}>
    <Stack.Screen options={{ headerShown: false }} />
    <StatusBar style="dark" />
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={s.back}
        onPress={onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/(tabs)/friends' as never))}>
        <ArrowLeft size={20} color={C.ink} />
      </Pressable>
      <ScaledText numberOfLines={2} style={{ ...T.body, fontFamily: fonts.medium, color: C.ink, flex: 1, minWidth: 0 }}>{title}</ScaledText>
      {busy && <ActivityIndicator accessibilityLabel="Saving" color={C.clay} />}
      <ProfileButton compact/>
    </View>
    <ScrollView innerViewRef={innerViewRef} ref={scrollRef} onScrollBeginDrag={onScrollBeginDrag} onContentSizeChange={onContentSizeChange} onLayout={onViewportLayout} key={contentKey} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.terracotta} /> : undefined} contentContainerStyle={[s.body, !!footer && s.bodyWithFooter]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
    {footer && <View style={s.footer}>{footer}</View>}
  </SafeAreaView>;
}
export const pageStyles = StyleSheet.create({
  eyebrow: { ...T.timestamp, color: C.muted, letterSpacing: 0.8, marginBottom: 8 },
  heading: { ...T.pageTitle, color: C.ink, marginBottom: 20 },
  body: { fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: C.muted, marginBottom: 20 },
  section: { ...T.pageSection, color: C.ink, marginTop: 24, marginBottom: 16 },
  row: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, gap: 6 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowTitle: { ...T.title, color: C.ink },
  small: { ...T.body, color: C.muted },
  notice: { padding: 16, borderWidth: 1, borderColor: C.line, borderRadius: 8, marginVertical: 12, gap: 12 },
  input: { padding: 14, minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: 8, color: C.ink, ...T.message },
});
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 56 },
  back: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 },
  bodyWithFooter: { paddingBottom: 16 },
  footer: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  action: { minHeight: 48, maxWidth: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, borderColor: C.line },
  quiet: { borderWidth: 0, alignItems: 'flex-start', paddingHorizontal: 0 },
  primary: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  actionText: { ...T.body, textAlign: 'center', flexShrink: 1 },
  actionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  leadingIcon: {flexShrink: 0, alignItems: 'center', justifyContent: 'center'},
  disclosureContent: { flex: 1, justifyContent: 'flex-start' },
  sunset: { paddingHorizontal: 24, borderColor: CreatorSurfaceColors.goldEdge, shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 3 },
  sunsetWithIcon: {paddingStart: 20, paddingEnd: 24},
  sunsetPressed: { transform: [{ scale: 0.98 }], shadowOpacity: 0.12, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  compact: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 20, alignSelf: 'flex-start' },
  compactText: { ...T.body },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, gap: 12 },
  disclosureText: { flexShrink: 1, textAlign: 'left' },
  disabled: { opacity: 0.5 },
});
