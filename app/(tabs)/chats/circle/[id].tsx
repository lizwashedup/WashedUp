import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { GROUPS_ENABLED } from '../../../../constants/FeatureFlags';
import Colors from '../../../../constants/Colors';
import { Fonts, FontSizes } from '../../../../constants/Typography';

// Gated stub for circle chat. The polymorphic data layer (useChat with a circle
// ConversationKey, useChatList circle rows) is already wired; the circle chat UI
// ships with the Circles design. With GROUPS_ENABLED off this route is not part
// of the product, so hitting the URL directly bounces back to the chat list.
export default function CircleChatScreen() {
  const router = useRouter();

  if (!GROUPS_ENABLED) {
    return <Redirect href="/(tabs)/chats" />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={24} color={Colors.asphalt} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Circle</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Circle chat</Text>
        <Text style={styles.subtitle}>This space is being built with the Circles rollout.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  headerSpacer: {
    width: 24,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
  },
});
