import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function YourPeopleScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.centered}>
        <Ionicons name="people-outline" size={48} color="#C4652A" />
        <Text style={styles.heading}>Your People</Text>
        <Text style={styles.subtext}>
          See what your friends are up to and make plans together. Coming soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  heading: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#1A1A1A',
    textAlign: 'center',
  },
  subtext: {
    fontSize: 15,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
  },
});
