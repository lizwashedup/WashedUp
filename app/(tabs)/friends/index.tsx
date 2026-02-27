import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ProfileButton from '../../../components/ProfileButton';

export default function YourPeopleScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your People</Text>
        <ProfileButton />
      </View>
      <View style={styles.centered}>
        <Ionicons name="people-outline" size={48} color="#C4652A" />
        <Text style={styles.subtext}>
          Add people you want to do things with.{'\n'}When you post a plan, invite them first —{'\n'}before anyone else sees it.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1e4d4' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#1A1A1A',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  subtext: {
    fontSize: 15,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
  },
});
