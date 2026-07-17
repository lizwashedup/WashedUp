/**
 * WishlistConfirmation: "you're on the list" (step 2b approved mockup).
 * Shown after the wishlist capture succeeds. States facts only: what we are
 * watching for and where to change it; promises no outcome.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { FIRST_JOIN_COPY as COPY } from '../../lib/firstJoin/copy';

interface WishlistConfirmationProps {
  neighborhood: string | null;
  vibeTags: string[];
  /** "take me to scene". */
  onContinue: () => void;
  /** "edit preferences" link (routes to existing notification settings). */
  onEditPreferences: () => void;
}

export function WishlistConfirmation({
  neighborhood,
  vibeTags,
  onContinue,
  onEditPreferences,
}: WishlistConfirmationProps) {
  const areaLabel = neighborhood ? neighborhood.toLowerCase() : COPY.watchingAnywhere;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.centerBlock}>
          <View style={styles.iconCircle}>
            <Ionicons name="notifications-outline" size={D.emptyIconSize} color={Colors.terracotta} />
            <View style={styles.checkBadge}>
              <Ionicons name="checkmark" size={D.checkBadgeIconSize} color={Colors.white} />
            </View>
          </View>

          <Text style={styles.headline}>{COPY.confirmHeadline}</Text>
          <Text style={styles.subline}>{COPY.confirmSubline}</Text>

          <View style={styles.watchingCard}>
            <Text style={styles.watchingLabel}>{COPY.watchingFor}</Text>
            <View style={styles.areaRow}>
              <Ionicons name="location-outline" size={D.watchingIconSize} color={Colors.terracotta} />
              <Text style={styles.areaText}>{areaLabel}</Text>
              <View style={styles.nearbyChip}>
                <Text style={styles.nearbyChipText}>{COPY.nearby}</Text>
              </View>
            </View>
            {vibeTags.length > 0 && (
              <View style={styles.vibeRow}>
                {vibeTags.map((tag) => (
                  <View key={tag} style={styles.vibeChip}>
                    <Text style={styles.vibeChipText}>{tag.toLowerCase()}</Text>
                  </View>
                ))}
              </View>
            )}
            <Pressable onPress={onEditPreferences} testID="first-join-edit-preferences">
              {({ pressed }) => (
                <Text style={[styles.editLink, pressed && styles.editLinkPressed]}>{COPY.editPreferences}</Text>
              )}
            </Pressable>
          </View>

          <Pressable onPress={onContinue} style={styles.ctaPressable} testID="first-join-confirm-cta">
            {({ pressed }) => (
              <View style={[styles.ctaButton, pressed && styles.ctaButtonPressed]}>
                <Text style={styles.ctaText}>{COPY.confirmCta}</Text>
              </View>
            )}
          </Pressable>

          <Text style={styles.footer}>{COPY.confirmFooter}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: D.screenPaddingH,
  },
  centerBlock: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: D.emptyIconCircle,
    height: D.emptyIconCircle,
    borderRadius: D.emptyIconCircle / 2,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    right: D.checkBadgeOffset,
    bottom: D.checkBadgeOffset,
    width: D.checkBadgeSize,
    height: D.checkBadgeSize,
    borderRadius: D.checkBadgeSize / 2,
    backgroundColor: Colors.pastMinimumGreen,
    borderWidth: D.avatarRingWidth,
    borderColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: Fonts.displayItalic,
    fontSize: D.headlineSize,
    lineHeight: D.headlineLineHeight,
    color: Colors.terracotta,
    marginTop: D.captionTopGap,
    textAlign: 'center',
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    maxWidth: D.emptyBodyMaxWidth,
    marginTop: D.sublineTopGap,
  },
  watchingCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.cardBg,
    borderRadius: D.cardRadius,
    padding: D.cardPadding,
    gap: D.cardGap,
    marginTop: D.sectionTopGap,
    shadowColor: Colors.warmShadow,
    shadowOpacity: D.cardShadowOpacity,
    shadowRadius: D.cardShadowRadius,
    shadowOffset: { width: 0, height: D.cardShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  watchingLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    letterSpacing: D.watchingLabelSpacing,
    textTransform: 'uppercase',
    color: Colors.terracotta,
  },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.creatorRowGap,
  },
  areaText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyLG,
    color: Colors.text1,
  },
  nearbyChip: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: D.pillRadius,
    paddingHorizontal: D.pillPaddingH,
    paddingVertical: D.pillPaddingV,
  },
  nearbyChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  vibeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: D.proofRowGap,
  },
  vibeChip: {
    backgroundColor: Colors.inputBg,
    borderRadius: D.pillRadius,
    paddingHorizontal: D.pillPaddingH,
    paddingVertical: D.pillPaddingV,
  },
  vibeChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.quoteText,
  },
  editLink: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  editLinkPressed: {
    color: Colors.brandPressed,
  },
  ctaPressable: {
    alignSelf: 'stretch',
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: D.buttonRadius,
    height: D.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: D.sectionTopGap,
    shadowColor: Colors.terracotta,
    shadowOpacity: D.ctaShadowOpacity,
    shadowRadius: D.ctaShadowRadius,
    shadowOffset: { width: 0, height: D.ctaShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  ctaButtonPressed: {
    backgroundColor: Colors.brandPressed,
  },
  ctaText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyLG,
    color: Colors.cream,
  },
  footer: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    textAlign: 'center',
    marginTop: D.captionTopGap,
  },
});
