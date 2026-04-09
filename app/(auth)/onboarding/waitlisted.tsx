import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

export default function OnboardingWaitlistedScreen() {
  const [city, setCity] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('city')
        .eq('id', user.id)
        .single();
      if (data?.city && data.city !== 'Other') setCity(data.city);
    })();
  }, []);

  const handleSignOut = async () => {
    hapticLight();
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.heading}>You&apos;re on the waitlist!</Text>
          <View style={styles.gap20} />
          <Text style={styles.body}>
            {city
              ? `We'll let you know when washedup comes to ${city}. We're working hard to bring it to you soon!`
              : `We'll let you know when washedup expands to your city. We're working hard to bring it to you soon!`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          onPressIn={() => hapticLight()}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between', paddingBottom: 16 },
  content: { flex: 1, justifyContent: 'center' },
  heading: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginBottom: 0,
  },
  gap20: { height: 20 },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.textMedium,
    lineHeight: 26,
  },
  signOutButton: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.displaySM,
    color: Colors.terracotta,
  },
});
