import React, { useState, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
import { Camera } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PHOTO_FORMAT_ERROR_MESSAGE } from '../../constants/PhotoUpload';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PROFILE_PHOTO_KEY } from '../../components/ProfileButton';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, displaySmall, bodySmall, bodyMedium, labelSmall } from '../../constants/Typography';

// Uses correct column names from profiles table: first_name_display, profile_photo_url, handle
interface Profile {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  gender: string | null;
  handle: string | null;
}

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [showEditFlow, setShowEditFlow] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [editPhotoBase64, setEditPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null);
  const [checkingHandle, setCheckingHandle] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchProfile();
    }, [])
  );

  // Debounced handle availability check (500ms) — skip if unchanged from current
  useEffect(() => {
    if (!showEditFlow) return;
    const clean = editHandle.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const currentHandle = (profile?.handle ?? '').toLowerCase().trim();
    if (clean.length < 2) {
      setHandleAvailable(null);
      return;
    }
    if (clean === currentHandle) {
      setHandleAvailable(true);
      return;
    }
    const t = setTimeout(async () => {
      setCheckingHandle(true);
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('handle', clean)
        .neq('id', profile?.id ?? '')
        .maybeSingle();
      setHandleAvailable(!data);
      setCheckingHandle(false);
    }, 500);
    return () => clearTimeout(t);
  }, [editHandle, profile?.handle, profile?.id, showEditFlow]);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name_display, profile_photo_url, bio, city, gender, handle')
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
        handle: (data as any).handle ?? null,
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

  const openEditFlow = () => {
    setEditName(profile?.first_name ?? '');
    setEditBio(profile?.bio ?? '');
    setEditHandle(profile?.handle ?? '');
    setEditPhotoUri(null);
    setEditPhotoBase64(null);
    setHandleAvailable(null);
    setCheckingHandle(false);
    setShowEditFlow(true);
  };

  const pickEditPhotoFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Go to Settings and allow photo access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    await processEditPhoto(result.assets[0].uri);
  };

  const takeEditPhotoFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Go to Settings and allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    await processEditPhoto(result.assets[0].uri);
  };

  const processEditPhoto = async (uri: string) => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setEditPhotoUri(manipulated.uri);
      setEditPhotoBase64(manipulated.base64 ?? null);
    } catch {
      Alert.alert('Invalid image', PHOTO_FORMAT_ERROR_MESSAGE);
    }
  };

  const pickEditPhoto = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Change photo', 'Choose how to add your photo', [
      { text: 'Take Photo', onPress: takeEditPhotoFromCamera },
      { text: 'Choose from Library', onPress: pickEditPhotoFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSaveProfile = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    const trimmedName = editName.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a display name.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let newPhotoUrl = profile?.avatar_url ?? null;

      if (editPhotoBase64) {
        const { data: { session }, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) throw new Error('Session expired. Please log in again.');
        if (!session?.user) throw new Error('Not authenticated');

        const path = `${user.id}/${Date.now()}.jpg`;
        newPhotoUrl = await uploadBase64ToStorage('profile-photos', path, editPhotoBase64, { upsert: true });
      }

      const handleVal = editHandle.trim().toLowerCase() || null;
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name_display: trimmedName,
          bio: editBio.trim() || null,
          profile_photo_url: newPhotoUrl,
          handle: handleVal,
        })
        .eq('id', user.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      setProfile((prev) =>
        prev ? { ...prev, first_name: trimmedName, bio: editBio.trim() || null, avatar_url: newPhotoUrl } : prev,
      );
      setShowEditFlow(false);
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
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
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.user) throw new Error(sessionError?.message ?? 'Not authenticated');

      // RPC deletes all public data + auth user in one call
      const { error: rpcError } = await supabase.rpc('delete_own_account');
      if (rpcError) throw rpcError;

      try {
        await supabase.auth.signOut();
      } catch {
        // Session invalid after deletion; ignore
      }
      router.replace('/login');
    } catch (err: any) {
      setDeleting(false);
      const msg = err?.message ?? String(err);
      Alert.alert(
        'Something went wrong',
        `We could not delete your account automatically. ${msg}\n\nPlease email hello@washedup.app and we will delete it within 24 hours.`,
      );
    }
  };

  // ── Settings rows (grouped: Legal, Support, Account) ───────────────────────

  const legalRows = [
    { icon: 'shield-outline', label: 'Privacy Policy', onPress: () => Linking.openURL('https://washedup.app/privacy') },
    { icon: 'document-text-outline', label: 'Terms of Service', onPress: () => Linking.openURL('https://washedup.app/terms') },
    { icon: 'people-outline', label: 'Community Guidelines', onPress: () => Linking.openURL('https://washedup.app/guidelines') },
  ];
  const supportRows = [
    { icon: 'mail-outline', label: 'Contact Us', onPress: () => Linking.openURL('mailto:hello@washedup.app') },
  ];

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
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
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>
          <Text style={styles.deleteHeaderTitle}>Delete Account</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.deleteContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {deleteStep === 1 && (
            <>
              <View style={styles.deleteWarningIcon}>
                <Ionicons name="warning-outline" size={40} color={Colors.terracotta} />
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
                placeholderTextColor={Colors.textLight}
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

  // ── Edit Profile Flow ───────────────────────────────────────────────────────

  if (showEditFlow) {
    const displayPhoto = editPhotoUri ?? profile?.avatar_url;
    const handleChanged = editHandle.trim().toLowerCase() !== (profile?.handle ?? '').trim().toLowerCase();
    const saveDisabledByHandle = handleChanged && (handleAvailable !== true || checkingHandle);
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.deleteHeader}>
          <TouchableOpacity
            onPress={() => setShowEditFlow(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>
          <Text style={styles.deleteHeaderTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.editContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={pickEditPhoto} activeOpacity={0.8} style={styles.editAvatarWrap}>
            {displayPhoto ? (
              <Image source={{ uri: displayPhoto }} style={styles.editAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.editAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>
                  {editName?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
            <View style={styles.editAvatarBadge}>
              <Camera size={14} color="#FFFFFF" strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
          <Text style={styles.editPhotoHint}>Tap to change photo</Text>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Display Name</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Your name"
              placeholderTextColor={Colors.textLight}
              maxLength={30}
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Handle</Text>
            <View style={styles.handleInputRow}>
              <Text style={styles.handlePrefix}>@</Text>
              <TextInput
                style={styles.handleInput}
                value={editHandle}
                onChangeText={(t) => setEditHandle(t.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                placeholder="yourname"
                placeholderTextColor={Colors.textLight}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            {checkingHandle ? (
              <ActivityIndicator size="small" color={Colors.textLight} style={styles.handleAvailability} />
            ) : handleAvailable === true ? (
              <Text style={styles.handleAvailable}>Available</Text>
            ) : handleAvailable === false ? (
              <Text style={styles.handleTaken}>Taken</Text>
            ) : null}
            <Text style={styles.editHelp}>This is how people find you on WashedUp</Text>
          </View>

          <View style={styles.editFieldGroup}>
            <Text style={styles.editLabel}>Bio</Text>
            <TextInput
              style={[styles.editInput, styles.editBioInput]}
              value={editBio}
              onChangeText={setEditBio}
              placeholder="Tell people a little about yourself"
              placeholderTextColor={Colors.textLight}
              maxLength={150}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
            />
            <Text style={styles.editCharCount}>{editBio.length}/150</Text>
          </View>

          {profile?.gender && (
            <View style={styles.editFieldGroup}>
              <Text style={styles.editLabel}>Gender Identity</Text>
              <View style={styles.editReadOnly}>
                <Text style={styles.editReadOnlyText}>
                  {profile.gender === 'woman' ? 'Woman' : profile.gender === 'man' ? 'Man' : 'Non-binary'}
                </Text>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.textLight} />
              </View>
              <Text style={styles.editHelp}>Contact hello@washedup.app to update</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.editSaveBtn, (saving || saveDisabledByHandle) && { opacity: 0.7 }]}
            onPress={handleSaveProfile}
            disabled={saving || saveDisabledByHandle}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.editSaveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteCancelBtn}
            onPress={() => setShowEditFlow(false)}
          >
            <Text style={styles.deleteCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Main Profile Screen ─────────────────────────────────────────────────────

  const renderSettingsRow = (row: { icon: string; label: string; onPress: () => void }, isLast: boolean) => (
    <TouchableOpacity
      key={row.label}
      style={[styles.settingsRow, !isLast && styles.settingsRowDivider]}
      onPress={row.onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={row.icon as any} size={20} color={Colors.terracotta} />
      <Text style={styles.settingsLabel}>{row.label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.warmGray} />
    </TouchableOpacity>
  );

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
            <Ionicons name="chevron-back" size={26} color={Colors.asphalt} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Profile header: avatar, display name, handle */}
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
          {profile?.handle ? (
            <Text style={styles.profileHandle}>@{profile.handle}</Text>
          ) : (
            <TouchableOpacity onPress={openEditFlow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.profileHandleLink}>Set a handle</Text>
            </TouchableOpacity>
          )}
          {profile?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={Colors.warmGray} />
              <Text style={styles.locationText}>{profile.city}</Text>
            </View>
          )}
          {profile?.bio && (
            <Text style={styles.bio}>{profile.bio}</Text>
          )}

          <TouchableOpacity style={styles.editProfileBtn} onPress={openEditFlow} activeOpacity={0.8}>
            <Ionicons name="create-outline" size={16} color={Colors.terracotta} />
            <Text style={styles.editProfileBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Legal</Text>
        </View>
        <View style={styles.settingsGroup}>
          {legalRows.map((row, i) => renderSettingsRow(row, i === legalRows.length - 1))}
        </View>

        {/* Support */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Support</Text>
        </View>
        <View style={styles.settingsGroup}>
          {supportRows.map((row, i) => renderSettingsRow(row, i === supportRows.length - 1))}
        </View>

        {/* Account */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
        </View>
        <View style={styles.settingsGroup}>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setShowDeleteFlow(true)} activeOpacity={0.7}>
            <Text style={styles.deleteAccountLink}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* Log Out button — full-width outlined at bottom */}
        <View style={styles.logOutWrap}>
          <TouchableOpacity style={styles.logOutBtn} onPress={handleLogOut} activeOpacity={0.85}>
            <Text style={styles.logOutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>WashedUp · hello@washedup.app</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
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
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.terracotta,
  },

  // Profile section — avatar 100px, display name displaySmall, handle bodySmall
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 8,
  },
  avatarContainer: {},
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.warmGray,
  },
  avatarFallback: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  profileName: {
    ...displaySmall,
    color: Colors.asphalt,
    marginTop: 4,
  },
  profileHandle: {
    ...bodySmall,
    color: Colors.warmGray,
    marginTop: 2,
  },
  profileHandleLink: {
    ...bodySmall,
    fontFamily: Fonts.sansMedium,
    color: Colors.terracotta,
    marginTop: 2,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { ...bodySmall, color: Colors.warmGray },
  bio: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },

  // Settings list — section headers labelSmall, rows with terracotta icon, bodyMedium label, warmGray chevron
  sectionHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  sectionTitle: {
    ...labelSmall,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  settingsGroup: {
    backgroundColor: Colors.cardBg,
    marginHorizontal: 20,
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  settingsRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.parchment,
  },
  settingsLabel: {
    ...bodyMedium,
    flex: 1,
    color: Colors.asphalt,
  },
  deleteAccountLink: {
    ...bodyMedium,
    flex: 1,
    color: '#dc2626',
  },
  logOutWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  logOutBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logOutBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },

  // Delete flow
  deleteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  deleteHeaderTitle: { fontFamily: Fonts.sansBold, fontSize: 17, color: Colors.asphalt },
  deleteContent: { padding: 24, alignItems: 'center', gap: 16 },
  deleteWarningIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  deleteTitle: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.asphalt, textAlign: 'center' },
  deleteBody: { fontFamily: Fonts.sans, fontSize: 15, color: Colors.textMedium, textAlign: 'center', lineHeight: 22 },
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
    color: Colors.asphalt,
    textAlign: 'center',
    letterSpacing: 2,
  },
  deleteNextBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteNextBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: 15 },
  deleteCancelBtn: { paddingVertical: 12 },
  deleteCancelBtnText: { fontFamily: Fonts.sans, fontSize: 15, color: Colors.warmGray },
  deleteFinalBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteFinalBtnDisabled: { backgroundColor: Colors.inputBg },
  deleteFinalBtnText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: 15 },

  // Edit Profile button on main profile
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.terracotta,
  },
  editProfileBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.terracotta,
  },

  // Edit Profile flow
  editContent: {
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  editAvatarWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  editAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.warmGray,
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.parchment,
  },
  editPhotoHint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.warmGray,
    marginBottom: 20,
  },
  editFieldGroup: {
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  editLabel: {
    ...labelSmall,
    color: Colors.warmGray,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  editInput: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  handleInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  handlePrefix: { fontFamily: Fonts.sans, fontSize: 16, color: Colors.textLight, marginLeft: 16 },
  handleInput: {
    flex: 1,
    paddingVertical: 14,
    paddingLeft: 8,
    paddingRight: 16,
    fontSize: 16,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  editBioInput: {
    minHeight: 90,
    paddingTop: 14,
  },
  editCharCount: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  editReadOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.inputBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  editReadOnlyText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: Colors.warmGray,
  },
  handleAvailability: { marginTop: 6, marginBottom: 4 },
  handleAvailable: { fontFamily: Fonts.sansMedium, fontSize: 12, color: Colors.successGreen, marginTop: 6, marginBottom: 4 },
  handleTaken: { fontFamily: Fonts.sansMedium, fontSize: 12, color: Colors.errorRed, marginTop: 6, marginBottom: 4 },
  editHelp: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 4,
  },
  editSaveBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.terracotta,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  editSaveBtnText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: 15,
  },

  // Footer
  footer: { textAlign: 'center', fontFamily: Fonts.sans, fontSize: 12, color: Colors.textLight, marginTop: 8 },
});
