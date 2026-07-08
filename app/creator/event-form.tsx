/**
 * Creator mode: post or edit an event (doc 08 events organ). Create asks
 * attribution once (from the community or just you, locked after, batch 15
 * call e) and publishes straight to Live (call a). Edit honors the
 * FULL-OVERWRITE contract: the form loads every field and always sends the
 * complete set (see lib/creatorEvents.ts). A community event offers "tell
 * your members" after publish, one-shot, never automatic. Functionally
 * minimal per decision 15a.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { getCreatorAccess } from '../../lib/creatorMode';
import {
  announceEventToMembers,
  createOperatorEvent,
  EVENT_CATEGORIES,
  getEventTemplate,
  getOperatorEvent,
  pickAndUploadEventImage,
  saveEventTemplate,
  updateOperatorEvent,
  type OperatorEventFields,
} from '../../lib/creatorEvents';

const POSTER_HEIGHT = 160;

export default function EventFormScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, duplicateFrom, templateId } = useLocalSearchParams<{ id?: string; duplicateFrom?: string; templateId?: string }>();
  const editing = !!id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [venue, setVenue] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [category, setCategory] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [ticketPrice, setTicketPrice] = useState('');
  const [publicName, setPublicName] = useState('');
  const [fromCommunity, setFromCommunity] = useState(true);
  const [pinToChat, setPinToChat] = useState(true);
  const [eventStatus, setEventStatus] = useState<string>('Live');
  const [eventCommunityId, setEventCommunityId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = access?.ledCommunities[0] ?? null;

  const { data: template } = useQuery({
    queryKey: ['event-template', templateId],
    queryFn: () => getEventTemplate(templateId!),
    enabled: !editing && !duplicateFrom && !!templateId,
  });
  useEffect(() => {
    if (!editing && !duplicateFrom && templateId && template && !seeded) {
      const f = template.fields;
      setTitle(f.title ?? '');
      setDescription(f.description ?? '');
      setImageUrl(f.image_url ?? '');
      setVenue(f.venue ?? '');
      setVenueAddress(f.venue_address ?? '');
      setCategory(f.category ?? '');
      setExternalUrl(f.external_url ?? '');
      setTicketPrice(f.ticket_price ?? '');
      setPublicName(f.public_name ?? '');
      setPinToChat(f.pin_to_chat ?? true);
      setFromCommunity(!!template.community_id);
      setSeeded(true);
    }
  }, [editing, duplicateFrom, templateId, template, seeded]);

  // duplicate = same clothes, fresh date: seed everything but date and time,
  // then run the normal create path (publish, chat born, tell-your-members)
  const sourceId = editing ? id : duplicateFrom || undefined;
  const { data: existing } = useQuery({
    queryKey: ['operator-event', sourceId],
    queryFn: () => getOperatorEvent(sourceId!),
    enabled: !!sourceId,
  });

  useEffect(() => {
    if (!editing && duplicateFrom && existing && !seeded) {
      setTitle(existing.title);
      setDescription(existing.description);
      setImageUrl(existing.image_url);
      setVenue(existing.venue);
      setVenueAddress(existing.venue_address);
      setCategory(existing.category);
      setExternalUrl(existing.external_url);
      setTicketPrice(existing.ticket_price);
      setPublicName(existing.public_name);
      setPinToChat(existing.pin_to_chat);
      setFromCommunity(!!existing.community_id);
      setSeeded(true);
      return;
    }
    if (editing && existing && !seeded) {
      setTitle(existing.title);
      setDescription(existing.description);
      setImageUrl(existing.image_url);
      setDate(existing.event_date);
      if (existing.start_time) {
        const d = new Date(existing.start_time);
        setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      }
      setVenue(existing.venue);
      setVenueAddress(existing.venue_address);
      setCategory(existing.category);
      setExternalUrl(existing.external_url);
      setTicketPrice(existing.ticket_price);
      setPublicName(existing.public_name);
      setPinToChat(existing.pin_to_chat);
      setEventStatus(existing.status);
      setEventCommunityId(existing.community_id);
      setSeeded(true);
    }
  }, [editing, existing, seeded]);

  const showError = (t: string, m: string) => setAlertInfo({ title: t, message: m });

  const collectFields = (): OperatorEventFields | null => {
    if (!title.trim()) {
      showError('Almost', 'A title is required.');
      return null;
    }
    if (!category) {
      // mirrors the server guard ("Pick a category."), caught here first
      showError('Almost', 'Pick a category.');
      return null;
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      showError('Check the date', 'Use the YYYY-MM-DD shape, like 2026-07-20.');
      return null;
    }
    if (time && !/^\d{2}:\d{2}$/.test(time.trim())) {
      showError('Check the time', 'Use the HH:MM shape, like 19:30.');
      return null;
    }
    let startTime: string | null = null;
    if (date && time) {
      const combined = new Date(`${date.trim()}T${time.trim()}:00`);
      if (isNaN(combined.getTime())) {
        showError('Check the date and time', 'That combination did not parse.');
        return null;
      }
      startTime = combined.toISOString();
    }
    return {
      title,
      description,
      image_url: imageUrl,
      event_date: date.trim(),
      start_time: startTime,
      venue,
      venue_address: venueAddress,
      category,
      external_url: externalUrl,
      ticket_price: ticketPrice,
      public_name: publicName,
      pin_to_chat: pinToChat,
    };
  };

  const afterSave = () => {
    queryClient.invalidateQueries({ queryKey: ['creator-events-tab'] });
    queryClient.invalidateQueries({ queryKey: ['operator-event', id] });
  };

  const offerAnnounce = (eventId: string) => {
    // LIZ COPY (taste call 9): opt-in, never automatic
    setAlertInfo({
      title: 'tell your members?',
      message: 'a short note lands in their notifications. once per event.',
      buttons: [
        { text: 'not now', style: 'cancel', onPress: () => router.back() },
        {
          text: 'tell them',
          onPress: async () => {
            try {
              await announceEventToMembers(eventId);
              hapticSuccess();
            } catch (e) {
              showError('That did not send', friendlyError(e, 'Try again from the event.'));
              return;
            }
            router.back();
          },
        },
      ],
    });
  };

  const handleSave = async () => {
    const fields = collectFields();
    if (!fields || saving) return;
    setSaving(true);
    try {
      if (editing && id) {
        await updateOperatorEvent(id, fields, null);
        hapticSuccess();
        afterSave();
        router.back();
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        const newId = await createOperatorEvent(fields, communityId);
        hapticSuccess();
        afterSave();
        if (communityId) {
          offerAnnounce(newId);
        } else {
          router.back();
        }
      }
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  };

  // creator event drafts (batch 20): p_publish false = status Draft, no chat;
  // the chat is born when the draft publishes
  const isDraft = editing && eventStatus === 'Draft';
  const handleSaveDraft = async () => {
    const fields = collectFields();
    if (!fields || saving) return;
    setSaving(true);
    try {
      if (editing && id) {
        await updateOperatorEvent(id, fields, null);
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        await createOperatorEvent(fields, communityId, false);
      }
      hapticSuccess();
      afterSave();
      router.back();
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublishDraft = async () => {
    const fields = collectFields();
    if (!fields || !id || saving) return;
    setSaving(true);
    try {
      await updateOperatorEvent(id, fields, 'Live');
      hapticSuccess();
      afterSave();
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      if (eventCommunityId) {
        offerAnnounce(id);
      } else {
        router.back();
      }
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    const fields = collectFields();
    if (!fields || saving) return;
    setSaving(true);
    try {
      const communityId = editing ? eventCommunityId : (fromCommunity && community ? community.id : null);
      await saveEventTemplate(fields.title, fields, communityId);
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['event-templates'] });
      // LIZ COPY
      setAlertInfo({ title: 'saved as a template', message: 'it lives on your events tab. put it on anytime.' });
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = (status: 'Completed' | 'Cancelled') => {
    const fields = collectFields();
    if (!fields || !id) return;
    // LIZ COPY
    setAlertInfo({
      title: status === 'Cancelled' ? 'cancel this event?' : 'mark it completed?',
      message:
        status === 'Cancelled'
          ? 'it comes off the scene everywhere. groups that formed around it keep their plans and decide for themselves.'
          : 'it comes off the scene and into your past events.',
      buttons: [
        { text: 'keep it live', style: 'cancel' },
        {
          text: status === 'Cancelled' ? 'cancel it' : 'complete it',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateOperatorEvent(id, fields, status);
              hapticLight();
              afterSave();
              router.back();
            } catch (e) {
              showError('That did not save', friendlyError(e, 'Try again in a moment.'));
            }
          },
        },
      ],
    });
  };

  const handlePoster = async () => {
    setUploading(true);
    try {
      const url = await pickAndUploadEventImage();
      if (url) setImageUrl(url);
    } catch (e) {
      showError('That photo did not upload', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setUploading(false);
    }
  };

  const loadingEdit = (editing || !!duplicateFrom) && !seeded;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        {loadingEdit ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{editing ? 'edit your event' : duplicateFrom ? 'put it on again' : 'put on an event'}</Text>
            {!editing && !!duplicateFrom && (
              /* LIZ COPY */
              <Text style={styles.statusLine}>same event, fresh date. pick the new one.</Text>
            )}
            {editing && eventStatus !== 'Live' && (
              /* LIZ COPY */
              <Text style={styles.statusLine}>
                {eventStatus === 'Draft'
                  ? 'a draft. only you see it until you publish.'
                  : `this event is ${eventStatus.toLowerCase()}.`}
              </Text>
            )}

            <Text style={styles.fieldLabel}>title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={120} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            <Text style={styles.fieldLabel}>the poster</Text>
            {imageUrl ? (
              <TouchableOpacity onPress={handlePoster} disabled={uploading}>
                <Image source={{ uri: imageUrl }} style={styles.poster} contentFit="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.posterAdd} onPress={handlePoster} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color={Colors.terracotta} />
                ) : (
                  <Plus size={22} color={Colors.terracotta} strokeWidth={2.5} />
                )}
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>what is it</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={4000}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={styles.fieldLabel}>date</Text>
                <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="2026-07-20" placeholderTextColor={Colors.inkSoft} autoCapitalize="none" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
              </View>
              <View style={styles.rowItem}>
                <Text style={styles.fieldLabel}>time</Text>
                <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="19:30" placeholderTextColor={Colors.inkSoft} autoCapitalize="none" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>venue</Text>
            <TextInput style={styles.input} value={venue} onChangeText={setVenue} maxLength={120} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
            <Text style={styles.fieldLabel}>address</Text>
            <TextInput style={styles.input} value={venueAddress} onChangeText={setVenueAddress} maxLength={200} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            <Text style={styles.fieldLabel}>category</Text>
            <View style={styles.chipWrap}>
              {EVENT_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, category === c && styles.chipOn]}
                  onPress={() => { hapticLight(); setCategory(category === c ? '' : c); }}
                >
                  <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>tickets link</Text>
            <Text style={styles.fieldHint}>eventbrite, your site, wherever people pay or reserve. free events skip it.</Text>
            <TextInput style={styles.input} value={externalUrl} onChangeText={setExternalUrl} placeholder="https://" placeholderTextColor={Colors.inkSoft} autoCapitalize="none" keyboardType="url" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            <Text style={styles.fieldLabel}>ticket price</Text>
            <TextInput style={styles.input} value={ticketPrice} onChangeText={setTicketPrice} placeholder="leave empty if free" placeholderTextColor={Colors.inkSoft} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            <Text style={styles.fieldLabel}>public listing name</Text>
            <Text style={styles.fieldHint}>a brand or venue name to front the listing. leave empty to show yours.</Text>
            <TextInput style={styles.input} value={publicName} onChangeText={setPublicName} maxLength={80} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            {!editing && community && (
              <>
                <Text style={styles.fieldLabel}>whose event is this</Text>
                <View style={styles.chipWrap}>
                  <TouchableOpacity
                    style={[styles.chip, fromCommunity && styles.chipOn]}
                    onPress={() => { hapticLight(); setFromCommunity(true); }}
                  >
                    <Text style={[styles.chipText, fromCommunity && styles.chipTextOn]}>from {community.name}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, !fromCommunity && styles.chipOn]}
                    onPress={() => { hapticLight(); setFromCommunity(false); }}
                  >
                    <Text style={[styles.chipText, !fromCommunity && styles.chipTextOn]}>just you</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.fieldHint}>this one is set at posting and stays put.</Text>
              </>
            )}
            {editing && (
              <Text style={styles.fieldHint}>
                {eventCommunityId ? 'a community event, set at posting.' : 'a standalone event, set at posting.'}
              </Text>
            )}

            {((!editing && fromCommunity && !!community) || (editing && !!eventCommunityId)) && (
              <>
                <Text style={styles.fieldLabel}>pin it in your chat</Text>
                {/* LIZ COPY */}
                <Text style={styles.fieldHint}>your soonest upcoming event sits at the top of your community chat.</Text>
                <View style={styles.chipWrap}>
                  <TouchableOpacity
                    style={[styles.chip, pinToChat && styles.chipOn]}
                    onPress={() => { hapticLight(); setPinToChat(true); }}
                  >
                    <Text style={[styles.chipText, pinToChat && styles.chipTextOn]}>pin it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, !pinToChat && styles.chipOn]}
                    onPress={() => { hapticLight(); setPinToChat(false); }}
                  >
                    <Text style={[styles.chipText, !pinToChat && styles.chipTextOn]}>keep it off the chat</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnBusy]}
              onPress={isDraft ? handlePublishDraft : handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>{isDraft ? 'publish it' : editing ? 'save' : 'put it up'}</Text>
              )}
            </TouchableOpacity>

            {(!editing || isDraft) && (
              <TouchableOpacity onPress={handleSaveDraft} disabled={saving} style={styles.quietLinkWrap} hitSlop={8}>
                {/* LIZ COPY */}
                <Text style={styles.quietLink}>{isDraft ? 'keep it a draft' : 'save it as a draft'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSaveTemplate} disabled={saving} style={styles.quietLinkWrap} hitSlop={8}>
              {/* LIZ COPY */}
              <Text style={styles.quietLink}>save it as a template</Text>
            </TouchableOpacity>

            {editing && eventStatus === 'Live' && (
              <View style={styles.statusRow}>
                <TouchableOpacity onPress={() => handleStatus('Completed')} hitSlop={6}>
                  <Text style={styles.statusLink}>mark completed</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleStatus('Cancelled')} hitSlop={6}>
                  <Text style={styles.statusLink}>cancel this event</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  statusLine: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary, marginBottom: 12 },
  fieldLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 14,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1 },
  poster: { width: '100%', height: POSTER_HEIGHT, borderRadius: 16, marginBottom: 14 },
  posterAdd: {
    height: POSTER_HEIGHT,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  quietLinkWrap: { alignItems: 'center', marginTop: 12 },
  quietLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  statusLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
});
