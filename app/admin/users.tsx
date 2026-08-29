import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticWarning, hapticSuccess } from '../../lib/haptics';
import { ArrowLeft, Bell, Search, UserX, X } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';
import { Keyboard } from 'react-native';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';

interface AdminUser {
  id: string;
  email: string | null;
  first_name_display: string | null;
  profile_photo_url: string | null;
  city: string | null;
  created_at: string;
  onboarding_status: string | null;
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [notifyingUser, setNotifyingUser] = useState<AdminUser | null>(null);
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationBody, setNotificationBody] = useState('');
  const [sendingNotification, setSendingNotification] = useState(false);

  React.useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => {
        const uid = data.user?.id ?? null;
        setUserId(uid);
        if (uid !== null && !isAdmin(uid)) router.back();
      })
      .catch(() => {});
  }, [router]);

  const { data: users = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, first_name_display, profile_photo_url, city, created_at, onboarding_status')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.first_name_display ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.city ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const openNotificationPrompt = (user: AdminUser) => {
    setNotificationTitle('');
    setNotificationBody('');
    setNotifyingUser(user);
  };

  const closeNotificationPrompt = () => {
    if (sendingNotification) return;
    setNotifyingUser(null);
    setNotificationTitle('');
    setNotificationBody('');
  };

  const sendNotification = async () => {
    if (!notifyingUser) return;

    const title = notificationTitle.trim();
    if (!title) {
      Alert.alert('Title required', 'Enter a short notification title.');
      return;
    }

    const recipientName = notifyingUser.first_name_display ?? 'this user';
    setSendingNotification(true);
    try {
      const { error } = await supabase.rpc('admin_send_user_notification', {
        p_user_id: notifyingUser.id,
        p_title: title,
        p_body: notificationBody.trim() || null,
      });
      if (error) throw error;

      hapticSuccess();
      setNotifyingUser(null);
      setNotificationTitle('');
      setNotificationBody('');
      Alert.alert('Sent', `Notification sent to ${recipientName}.`);
    } catch (e: any) {
      Alert.alert('Error', friendlyError(e, 'Could not send notification. Try again.'));
    } finally {
      setSendingNotification(false);
    }
  };

  const handleDeleteAndBan = (user: AdminUser) => {
    const name = user.first_name_display ?? 'this user';
    Alert.alert(
      `Delete & Ban ${name}?`,
      `This will permanently delete their account, all their plans and messages, and ban their email so they cannot re-register. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete & Ban',
          style: 'destructive',
          onPress: async () => {
            setRemoving(user.id);
            hapticWarning();
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) throw new Error('Not authenticated');

              const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-manage-user', {
                body: { action: 'delete_and_ban', targetUserId: user.id },
              });
              if (fnError) throw fnError;
              if (fnData?.error) throw new Error(fnData.error);

              hapticSuccess();
              queryClient.invalidateQueries({ queryKey: ['admin-users'] });
              Alert.alert('Done', `${name} has been deleted and banned.`);
            } catch (e: any) {
              Alert.alert('Error', friendlyError(e, 'Could not remove user. Try again.'));
            } finally {
              setRemoving(null);
            }
          },
        },
      ],
    );
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Users</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.warmGray} strokeWidth={2} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, email, or city…"
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
          inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
        />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          decelerationRate="normal"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.countLabel}>
            {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
          </Text>

          {filtered.map((user) => (
            <View key={user.id} style={styles.card}>
              <Image
                source={user.profile_photo_url ? { uri: user.profile_photo_url } : undefined}
                style={styles.avatar}
                contentFit="cover"
              />
              <View style={styles.cardInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user.first_name_display ?? 'Unknown'}
                </Text>
                <Text style={styles.userMeta} numberOfLines={1}>
                  {[user.city, formatDate(user.created_at)].filter(Boolean).join(' · ')}
                </Text>
                {user.onboarding_status && user.onboarding_status !== 'complete' && (
                  <Text style={styles.statusBadge}>{user.onboarding_status}</Text>
                )}
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  style={styles.notifyBtn}
                  onPress={() => openNotificationPrompt(user)}
                  hitSlop={8}
                  accessibilityLabel={`Notify ${user.first_name_display ?? 'user'}`}
                >
                  <Bell size={18} color={Colors.terracotta} strokeWidth={2} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.banBtn, removing === user.id && { opacity: 0.5 }]}
                  onPress={() => handleDeleteAndBan(user)}
                  disabled={removing === user.id}
                  hitSlop={8}
                >
                  {removing === user.id ? (
                    <ActivityIndicator size="small" color={Colors.errorRed} />
                  ) : (
                    <UserX size={18} color={Colors.errorRed} strokeWidth={2} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {filtered.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal
        visible={notifyingUser !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeNotificationPrompt}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity
                style={styles.modalHeaderBtn}
                onPress={closeNotificationPrompt}
                disabled={sendingNotification}
                hitSlop={12}
              >
                <X size={22} color={Colors.asphalt} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.modalTitle} numberOfLines={1}>
                Notify {notifyingUser?.first_name_display ?? 'user'}
              </Text>
              <View style={styles.modalHeaderBtn} />
            </View>

            <View style={styles.notificationForm}>
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={notificationTitle}
                  onChangeText={setNotificationTitle}
                  placeholder="Short notification title"
                  placeholderTextColor={Colors.textLight}
                  maxLength={80}
                  autoFocus
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Message</Text>
                <TextInput
                  style={[styles.input, styles.messageInput]}
                  value={notificationBody}
                  onChangeText={setNotificationBody}
                  placeholder="Optional message"
                  placeholderTextColor={Colors.textLight}
                  multiline
                  maxLength={240}
                  textAlignVertical="top"
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  (!notificationTitle.trim() || sendingNotification) && styles.sendBtnDisabled,
                ]}
                onPress={sendNotification}
                disabled={!notificationTitle.trim() || sendingNotification}
              >
                {sendingNotification ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.sendBtnText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.asphalt },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: { flexShrink: 0 },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },

  list: { flex: 1 },
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },

  countLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginBottom: 4,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBg,
    flexShrink: 0,
  },
  cardInfo: { flex: 1, gap: 2 },
  userName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  userMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  statusBadge: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.goldenAmber,
    marginTop: 2,
  },

  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  banBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.errorBgLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  modalContainer: { flex: 1, backgroundColor: Colors.parchment },
  modalKeyboardView: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalHeaderBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  notificationForm: { padding: 20, gap: 4 },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  messageInput: { minHeight: 104 },
  sendBtn: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },

  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray },
});
