import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ArrowLeft, Plus, X, Pencil, Trash2, ImagePlus } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isAdmin } from '../../constants/Admin';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';

interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  ticket_price: string | null;
  status: string;
}

const EMPTY_FORM = {
  title: '',
  description: '',
  image_url: '',
  event_date: '',
  venue: '',
  venue_address: '',
  category: '',
  external_url: '',
  ticket_price: '',
};

const CATEGORIES = ['Music', 'Food', 'Outdoors', 'Nightlife', 'Film', 'Art', 'Fitness', 'Comedy', 'Wellness', 'Sports', 'Community'];

export default function AdminEventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SceneEvent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim()) { setAlertInfo({ title: 'Title required' }); return; }
    setSendingBroadcast(true);
    try {
      const { error } = await supabase.rpc('admin_send_broadcast', {
        p_title: broadcastTitle.trim(),
        p_body: broadcastBody.trim() || null,
      });
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAlertInfo({ title: 'Sent', message: 'Broadcast delivered to all users.' });
      setBroadcastTitle('');
      setBroadcastBody('');
    } catch (e: any) {
      setAlertInfo({ title: 'Failed', message: e.message ?? 'Could not send broadcast.' });
    } finally {
      setSendingBroadcast(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingImage(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      const fileName = `admin/${Date.now()}.jpg`;
      const response = await fetch(manipulated.uri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from('event-images')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('event-images').getPublicUrl(fileName);
      setForm(f => ({ ...f, image_url: urlData.publicUrl }));
    } catch (e: any) {
      setAlertInfo({ title: 'Upload failed', message: e.message ?? 'Could not upload image.' });
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (userId !== null && !isAdmin(userId)) router.back();
  }, [userId, router]);

  const { data: waitlist = [], refetch: refetchWaitlist } = useQuery({
    queryKey: ['admin-city-waitlist'],
    queryFn: async (): Promise<{ city: string; count: number }[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('city')
        .eq('onboarding_status', 'waitlisted');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const c = row.city ?? 'Unknown';
        counts[c] = (counts[c] ?? 0) + 1;
      }
      return Object.entries(counts)
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 60_000,
  });

  const { data: events = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-scene-events'],
    queryFn: async (): Promise<SceneEvent[]> => {
      const { data, error } = await supabase
        .from('explore_events')
        .select('id, title, description, image_url, event_date, venue, venue_address, category, external_url, ticket_price, status')
        .order('event_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const openCreate = () => {
    setEditingEvent(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (e: SceneEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingEvent(e);
    setForm({
      title: e.title ?? '',
      description: e.description ?? '',
      image_url: e.image_url ?? '',
      event_date: e.event_date ?? '',
      venue: e.venue ?? '',
      venue_address: e.venue_address ?? '',
      category: e.category ?? '',
      external_url: e.external_url ?? '',
      ticket_price: e.ticket_price ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setAlertInfo({ title: 'Title required', message: 'Please enter an event title.' });
      return;
    }
    setSaving(true);
    try {
      if (editingEvent) {
        const { error } = await supabase.rpc('admin_update_explore_event', {
          p_event_id: editingEvent.id,
          p_title: form.title,
          p_description: form.description,
          p_image_url: form.image_url,
          p_event_date: form.event_date,
          p_venue: form.venue,
          p_venue_address: form.venue_address,
          p_category: form.category,
          p_external_url: form.external_url,
          p_ticket_price: form.ticket_price,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('admin_create_explore_event', {
          p_title: form.title,
          p_description: form.description || null,
          p_image_url: form.image_url || null,
          p_event_date: form.event_date || null,
          p_venue: form.venue || null,
          p_venue_address: form.venue_address || null,
          p_category: form.category || null,
          p_external_url: form.external_url || null,
          p_ticket_price: form.ticket_price || null,
        });
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['admin-scene-events'] });
      setShowForm(false);
      setEditingEvent(null);
    } catch (e: any) {
      setAlertInfo({ title: 'Error', message: e.message ?? 'Could not save. Make sure the admin migration has been run.' });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = (ev: SceneEvent) => {
    setAlertInfo({
      title: ev.status === 'Live' ? 'Archive event?' : 'Restore event?',
      message: ev.status === 'Live' ? 'This will hide it from the Scene tab.' : 'This will make it visible again.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: ev.status === 'Live' ? 'Archive' : 'Restore',
          style: ev.status === 'Live' ? 'destructive' : 'default',
          onPress: async () => {
            const newStatus = ev.status === 'Live' ? 'Archived' : 'Live';
            await supabase.rpc('admin_update_explore_event', {
              p_event_id: ev.id,
              p_status: newStatus,
            });
            queryClient.invalidateQueries({ queryKey: ['admin-scene-events'] });
          },
        },
      ],
    });
  };

  const liveEvents = events.filter(e => e.status === 'Live');
  const archivedEvents = events.filter(e => e.status !== 'Live');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scene Events</Text>
        <TouchableOpacity onPress={openCreate} style={styles.headerBtn} hitSlop={12}>
          <Plus size={22} color={Colors.terracotta} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          {liveEvents.length > 0 && (
            <Text style={styles.sectionLabel}>Live ({liveEvents.length})</Text>
          )}
          {liveEvents.map((e) => (
            <EventCard key={e.id} event={e} onEdit={() => openEdit(e)} onArchive={() => handleArchive(e)} />
          ))}

          {archivedEvents.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Archived ({archivedEvents.length})</Text>
              {archivedEvents.map((e) => (
                <EventCard key={e.id} event={e} onEdit={() => openEdit(e)} onArchive={() => handleArchive(e)} archived />
              ))}
            </>
          )}

          {events.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No Scene events yet</Text>
              <Text style={styles.emptySubtext}>Tap + to create your first one</Text>
            </View>
          )}

          {/* Broadcast section */}
          <Text style={[styles.sectionLabel, { marginTop: 32 }]}>Send Broadcast</Text>
          <View style={styles.broadcastCard}>
            <TextInput
              style={styles.broadcastInput}
              placeholder="Title (required)"
              placeholderTextColor={Colors.textLight}
              value={broadcastTitle}
              onChangeText={setBroadcastTitle}
              maxLength={100}
            />
            <TextInput
              style={[styles.broadcastInput, { minHeight: 60 }]}
              placeholder="Body (optional)"
              placeholderTextColor={Colors.textLight}
              value={broadcastBody}
              onChangeText={setBroadcastBody}
              multiline
              maxLength={300}
            />
            <TouchableOpacity
              style={[styles.broadcastBtn, (!broadcastTitle.trim() || sendingBroadcast) && { opacity: 0.5 }]}
              onPress={sendBroadcast}
              disabled={!broadcastTitle.trim() || sendingBroadcast}
            >
              {sendingBroadcast ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.broadcastBtnText}>Send to all users</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* City Waitlist section */}
          <Text style={[styles.sectionLabel, { marginTop: 32 }]}>
            City Waitlist ({waitlist.reduce((s, r) => s + r.count, 0)})
          </Text>
          {waitlist.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptySubtext}>No one on the waitlist yet</Text>
            </View>
          ) : (
            <View style={styles.waitlistCard}>
              {waitlist.map(({ city, count }, i) => (
                <View key={city} style={[styles.waitlistRow, i === waitlist.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.waitlistCity}>{city}</Text>
                  <Text style={styles.waitlistCount}>{count}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Create / Edit modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={12}>
                <X size={22} color={Colors.asphalt} strokeWidth={2} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editingEvent ? 'Edit Event' : 'New Scene Event'}</Text>
              <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={12}>
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.terracotta} />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <FormField label="Title *" value={form.title} onChange={(v) => setForm(f => ({ ...f, title: v }))} />
              <FormField label="Description" value={form.description} onChange={(v) => setForm(f => ({ ...f, description: v }))} multiline />
              <Text style={styles.fieldLabel}>Image</Text>
              {form.image_url ? (
                <View style={styles.imagePreviewWrap}>
                  <Image source={{ uri: form.image_url }} style={styles.imagePreview} contentFit="cover" />
                  <TouchableOpacity style={styles.imageRemoveBtn} onPress={() => setForm(f => ({ ...f, image_url: '' }))}>
                    <X size={16} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.imageUploadBtn} onPress={pickImage} disabled={uploadingImage}>
                  {uploadingImage ? (
                    <ActivityIndicator size="small" color={Colors.terracotta} />
                  ) : (
                    <>
                      <ImagePlus size={24} color={Colors.terracotta} strokeWidth={1.5} />
                      <Text style={styles.imageUploadText}>Upload Image</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <FormField label="Or paste image URL" value={form.image_url} onChange={(v) => setForm(f => ({ ...f, image_url: v }))} placeholder="https://..." autoCapitalize="none" />
              <FormField label="Event Date" value={form.event_date} onChange={(v) => setForm(f => ({ ...f, event_date: v }))} placeholder="2026-03-15 or Mar 15" />
              <FormField label="Venue" value={form.venue} onChange={(v) => setForm(f => ({ ...f, venue: v }))} />
              <FormField label="Venue Address" value={form.venue_address} onChange={(v) => setForm(f => ({ ...f, venue_address: v }))} />

              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow} contentContainerStyle={styles.catRowContent}>
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, form.category === cat && styles.catChipActive]}
                    onPress={() => setForm(f => ({ ...f, category: f.category === cat ? '' : cat }))}
                  >
                    <Text style={[styles.catChipText, form.category === cat && styles.catChipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <FormField label="Ticket URL" value={form.external_url} onChange={(v) => setForm(f => ({ ...f, external_url: v }))} placeholder="https://..." autoCapitalize="none" />
              <FormField label="Ticket Price" value={form.ticket_price} onChange={(v) => setForm(f => ({ ...f, ticket_price: v }))} placeholder="Free, $10, $25-50" />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

function EventCard({ event, onEdit, onArchive, archived = false }: { event: SceneEvent; onEdit: () => void; onArchive: () => void; archived?: boolean }) {
  return (
    <View style={[styles.card, archived && styles.cardArchived]}>
      {event.image_url && (
        <Image source={{ uri: event.image_url }} style={styles.cardImg} contentFit="cover" />
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
            <Text style={styles.cardMeta}>
              {[event.event_date, event.venue, event.category, event.ticket_price]
                .filter(Boolean)
                .join(' · ') || 'No details'}
            </Text>
            {archived && <Text style={styles.cardStatus}>Archived</Text>}
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity onPress={onEdit} style={styles.actionBtn} hitSlop={8}>
              <Pencil size={16} color={Colors.terracotta} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onArchive} style={styles.actionBtn} hitSlop={8}>
              <Trash2 size={16} color={archived ? Colors.terracotta : Colors.textLight} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function FormField({ label, value, onChange, multiline = false, placeholder, autoCapitalize }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? label}
        placeholderTextColor={Colors.textLight}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
      />
    </View>
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

  list: { flex: 1 },
  listContent: { padding: 20, gap: 12, paddingBottom: 40 },

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardArchived: { opacity: 0.6 },
  cardImg: { width: '100%', height: 120, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  cardBody: { padding: 16 },
  cardTop: { flexDirection: 'row', gap: 12 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt, marginBottom: 4 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  cardStatus: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.errorRed, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  actionBtn: { padding: 6 },

  empty: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  emptySubtext: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },

  modalContainer: { flex: 1, backgroundColor: Colors.parchment },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  saveText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },

  formContent: { padding: 20, gap: 4, paddingBottom: 60 },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt, marginBottom: 6 },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },

  imagePreviewWrap: { marginBottom: 12, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  imagePreview: { width: '100%', height: 160, borderRadius: 12 },
  imageRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageUploadBtn: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  imageUploadText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },

  catRow: { marginBottom: 12 },
  catRowContent: { gap: 8 },
  catChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Colors.white,
  },
  catChipActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  catChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  catChipTextActive: { color: Colors.white },

  broadcastCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 32,
  },
  broadcastInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sans,
    color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  broadcastBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  broadcastBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },

  waitlistCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 32,
  },
  waitlistRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  waitlistCity: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  waitlistCount: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
