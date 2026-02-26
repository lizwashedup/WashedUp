import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  ActivityIndicator,
  TextInput,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

// Uses correct column names from profiles table: first_name_display, profile_photo_url
interface Profile {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  gender: string | null;
}

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name_display, profile_photo_url, bio, city, gender')
      .eq('id', user.id)
      .single();
    if (data) {
      setProfile({
        id: data.id,
        first_name: (data as any).first_name_display ?? null,
        avatar_url: (data as any).profile_photo_url ?? null,
        bio: data.bio ?? null,
        city: data.city ?? null,
        gender: data.gender ?? null,
      });
    }
    setLoading(false);
  };

  const handleLogOut = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => supabase.auth.signOut(),
      },
    ]);
  };

  const resetDeleteFlow = () => {
    setShowDeleteFlow(false);
    setDeleteStep(1);
    setDeleteConfirmText('');
  };

  // ── Delete Account Flow ─────────────────────────────────────────────────────
  // Apple App Store requires in-app account deletion that actually removes data.
  // Three-step: Warning → Consequences → Type DELETE to confirm

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Type DELETE to confirm', 'Please type DELETE in all caps to confirm.');
      return;
    }

    setDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: rpcError } = await supabase.rpc('delete_own_account');
      if (rpcError) {
        console.warn('delete_own_account RPC failed, falling back to manual cleanup:', rpcError.message);
        await supabase.from('wishlists').delete().eq('user_id', user.id);
        await supabase.from('message_likes').delete().eq('user_id', user.id);
        await supabase.from('chat_reads').delete().eq('user_id', user.id);
        await supabase.from('messages').delete().eq('user_id', user.id);
        await supabase.from('event_members').delete().eq('user_id', user.id);
        await supabase.from('profiles').delete().eq('id', user.id);
      }

      await supabase.auth.signOut();
    } catch {
      setDeleting(false);
      Alert.alert(
        'Something went wrong',
        'We could not delete your account automatically. Please email hello@washedup.app and we will delete it within 24 hours.',
      );
    }
  };

  // ── Settings rows ───────────────────────────────────────────────────────────

  const settingsRows = [
    {
      icon: 'shield-outline',
      label: 'Privacy Policy',
      onPress: () => Linking.openURL('https://washedup.app/privacy-policy'),
    },
    {
      icon: 'document-text-outline',
      label: 'Terms of Service',
      onPress: () => Linking.openURL('https://washedup.app/terms-of-service'),
    },
    {
      icon: 'people-outline',
      label: 'Community Guidelines',
      onPress: () => Linking.openURL('https://washedup.app/community-guidelines'),
    },
    {
      icon: 'mail-outline',
      label: 'Contact Us',
      onPress: () => Linking.openURL('mailto:hello@washedup.app'),
    },
  ];

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Delete Flow ─────────────────────────────────────────────────────────────

  if (showDeleteFlow) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.deleteHeader}>
          <TouchableOpacity
            onPress={resetDeleteFlow}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.deleteHeaderTitle}>Delete Account</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.deleteContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {deleteStep === 1 && (
            <>
              <View style={styles.deleteWarningIcon}>
                <Ionicons name="warning-outline" size={40} color="#C4652A" />
              </View>
              <Text style={styles.deleteTitle}>Are you sure?</Text>
              <Text style={styles.deleteBody}>
                Deleting your account is permanent and cannot be undone.{'\n\n'}
                All your plans, chats, and profile data will be permanently removed.
              </Text>
              <TouchableOpacity
                style={styles.deleteNextBtn}
                onPress={() => setDeleteStep(2)}
              >
                <Text style={styles.deleteNextBtnText}>I understand, continue</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteCancelBtn} onPress={resetDeleteFlow}>
                <Text style={styles.deleteCancelBtnText}>Keep my account</Text>
              </TouchableOpacity>
            </>
          )}

          {deleteStep === 2 && (
            <>
              <View style={[styles.deleteWarningIcon, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="trash-outline" size={40} color="#dc2626" />
              </View>
              <Text style={styles.deleteTitle}>What you'll lose</Text>
              {[
                'Your profile and all personal information',
                'All plans you created or joined',
                'All chat messages',
                'Your saved wishlist',
              ].map((item, i) => (
                <View key={i} style={styles.deleteListRow}>
                  <Ionicons name="close-circle" size={18} color="#dc2626" />
                  <Text style={styles.deleteListText}>{item}</Text>
                </View>
              ))}
              <Text style={[styles.deleteBody, { marginTop: 24 }]}>
                Type DELETE below to permanently delete your account.
              </Text>
              <TextInput
                style={styles.deleteInput}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="Type DELETE here"
                placeholderTextColor="#C8BEB5"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.deleteFinalBtn,
                  deleteConfirmText.trim().toUpperCase() !== 'DELETE' && styles.deleteFinalBtnDisabled,
                ]}
                onPress={handleDeleteAccount}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.deleteFinalBtnText}>Permanently Delete Account</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteCancelBtn}
                onPress={() => setDeleteStep(1)}
              >
                <Text style={styles.deleteCancelBtnText}>Go back</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Main Profile Screen ─────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header row with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={26} color="#1C1917" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Avatar + Name */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>
                  {profile?.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.profileName}>{profile?.first_name ?? 'Your Profile'}</Text>
          {profile?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color="#9B8B7A" />
              <Text style={styles.locationText}>{profile.city}</Text>
            </View>
          )}
          {profile?.bio && (
            <Text style={styles.bio}>{profile.bio}</Text>
          )}
        </View>

        {/* Settings */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Settings</Text>
        </View>

        <View style={styles.settingsGroup}>
          {settingsRows.map((row, i) => (
            <TouchableOpacity
              key={row.label}
              style={[styles.settingsRow, i < settingsRows.length - 1 && styles.settingsRowBorder]}
              onPress={row.onPress}
              activeOpacity={0.7}
            >
              <Ionicons name={row.icon as any} size={20} color="#9B8B7A" />
              <Text style={styles.settingsLabel}>{row.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#C8BEB5" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Account */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
        </View>

        <View style={styles.settingsGroup}>
          <TouchableOpacity
            style={[styles.settingsRow, styles.settingsRowBorder]}
            onPress={handleLogOut}
            activeOpacity={0.7}
          >
            <Ionicons name="log-out-outline" size={20} color="#9B8B7A" />
            <Text style={styles.settingsLabel}>Log Out</Text>
            <Ionicons name="chevron-forward" size={16} color="#C8BEB5" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => setShowDeleteFlow(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={20} color="#dc2626" />
            <Text style={[styles.settingsLabel, { color: '#dc2626' }]}>Delete Account</Text>
            <Ionicons name="chevron-forward" size={16} color="#C8BEB5" />
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>WashedUp · hello@washedup.app</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 32,
    color: '#1C1917',
  },

  // Profile section
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 8,
  },
  avatarContainer: {
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: '#C4652A',
  },
  avatarFallback: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: '#C4652A' },
  profileName: { fontSize: 22, fontWeight: '700', color: '#1C1917', marginTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: 13, color: '#9B8B7A' },
  bio: {
    fontSize: 14,
    color: '#44403C',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },

  // Settings list
  sectionHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9B8B7A',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  settingsGroup: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
    shadowColor: '#1C1917',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  settingsRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0E6D3' },
  settingsLabel: { flex: 1, fontSize: 15, color: '#1C1917', fontWeight: '500' },

  // Delete flow
  deleteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  deleteHeaderTitle: { fontSize: 17, fontWeight: '700', color: '#1C1917' },
  deleteContent: { padding: 24, alignItems: 'center', gap: 16 },
  deleteWarningIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF0E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  deleteTitle: { fontSize: 24, fontWeight: '700', color: '#1C1917', textAlign: 'center' },
  deleteBody: { fontSize: 15, color: '#44403C', textAlign: 'center', lineHeight: 22 },
  deleteListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
  },
  deleteListText: { fontSize: 15, color: '#44403C', flex: 1 },
  deleteInput: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F0E6D3',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1917',
    textAlign: 'center',
    letterSpacing: 2,
  },
  deleteNextBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#C4652A',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteNextBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  deleteCancelBtn: { paddingVertical: 12 },
  deleteCancelBtnText: { fontSize: 15, color: '#9B8B7A' },
  deleteFinalBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteFinalBtnDisabled: { backgroundColor: '#F0E6D3' },
  deleteFinalBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Footer
  footer: { textAlign: 'center', fontSize: 12, color: '#C8BEB5', marginTop: 8 },
});
