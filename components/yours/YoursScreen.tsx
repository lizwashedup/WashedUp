/**
 * Root of the rebuilt Yours experience.
 *
 * Stub for the mechanical-move commit. Real implementation (state machine
 * over the typed hooks -> Populated / FreshStart / NewUserEmpty) is built
 * in Part C2. Only ever mounted when YOURS_PAGE_ENABLED is true, so this
 * placeholder never renders in the flag-off prod default.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

export default function YoursScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.center}>
        <Text style={styles.wordmark}>yours</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
});
