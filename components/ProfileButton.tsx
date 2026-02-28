import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { User } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

export default function ProfileButton() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const fetchPhoto = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('profile_photo_url')
      .eq('id', user.id)
      .single();
    setPhotoUrl(data?.profile_photo_url ?? null);
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchPhoto();
    }, [])
  );

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/profile')}
      accessibilityLabel="Profile"
    >
      <View style={styles.circle}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          <User size={20} color="#1A1A1A" strokeWidth={2} />
        )}
      </View>
      <Text style={styles.label}>Profile</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    color: '#999999',
  },
});
