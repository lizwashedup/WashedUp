import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

export default function ProfileScreen() {
  const handleLogOut = () => {
    supabase.auth.signOut();
  };

  return (
    <SafeAreaView className="flex-1 bg-washedup-cream" edges={['top', 'bottom']}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.logOutButton} onPress={handleLogOut} activeOpacity={0.9}>
          <Text style={styles.logOutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logOutButton: {
    height: 52,
    paddingHorizontal: 32,
    borderRadius: 14,
    backgroundColor: Colors.primaryOrange,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryOrange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logOutText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
