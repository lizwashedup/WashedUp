/**
 * PlanComposerV2 - the redesigned main composer (Golden Hour design study v3).
 *
 * Rendered only when YOURS_PAGE_ENABLED is true. Owns its own state and submit
 * so the frozen LegacyComposer carries zero risk. Built one section at a time
 * per composer-redesign-build-spec.md; this is the Step 0 scaffold (chrome +
 * empty scroll). Subsequent steps fill the scroll and the sticky post bar.
 */
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

export default function PlanComposerV2() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            hapticLight();
            if (router.canGoBack()) router.back();
          }}
          hitSlop={12}
        >
          <Text style={styles.cancel}>cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>new plan</Text>
        <Text style={styles.postInline}>post</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Sections land here in Steps 1-5. */}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cancel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  headerTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  postInline: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
});
