import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { hapticLight } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';

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
        .maybeSingle();
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
        <View style={styles.brandRow}>
          <Image
            source={require('../../../assets/images/w-logo-waves.png')}
            style={styles.wMark}
            resizeMode="contain"
          />
        </View>

        <View style={styles.content}>
          <Text style={styles.heading}>
            <Text style={styles.headingSans}>you’re on the </Text>
            <Text style={styles.headingItalic}>waitlist.</Text>
          </Text>
          <Text style={styles.body}>
            {city
              ? `we’ll let you know the moment washedup lands in ${city}. we’re expanding as fast as we can.`
              : `we’ll let you know the moment washedup expands to your city. we’re expanding as fast as we can.`}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.85}
        >
          <Text style={styles.signOutText}>sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wMark: { width: 28, height: 28, tintColor: Colors.brand },
  wordmark: { width: 92, height: 22, tintColor: Colors.text1, opacity: 0.92 },

  content: { flex: 1, justifyContent: 'center' },

  heading: {
    fontSize: 36,
    lineHeight: 40,
    color: Colors.text1,
    marginBottom: 16,
  },
  headingSans: { fontFamily: Fonts.headline },
  headingItalic: { fontFamily: Fonts.displayItalic, fontStyle: 'italic' },

  body: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text2,
  },

  signOutButton: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  signOutText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 15,
    color: Colors.brand,
    letterSpacing: 0.2,
  },
});
