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
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Check, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { DescriptionBlocksEditor } from '../../components/creator/DescriptionBlocksEditor';
import { type DescriptionBlock } from '../../lib/eventContent';
import { COVER_ASPECT, COVER_ASPECT_LABEL, EventAction, EventSpacing, EventSurface } from '../../constants/EventDesign';
import EditorialTitleField from '../../components/composer/EditorialTitleField';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { formatEventDateLA, getLAWallParts, isBeforeTodayLA, laWallTimeToUTC } from '../../lib/laDate';
import CollapsibleCalendar from '../../components/composer/CollapsibleCalendar';
import TimePicker from '../../components/composer/TimePicker';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import EventPlaceSearch from '../../components/creator/EventPlaceSearch';
import { EventLocationMap } from '../../components/creator/EventLocationMap';
import { getCreatorAccess } from '../../lib/creatorMode';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { supabase } from '../../lib/supabase';
import { eventHasPaidTier, getMyPayoutState, isPayoutReady } from '../../lib/ticketing';
import {
  announceEventToMembers,
  createOperatorEvent,
  EVENT_CATEGORIES,
  getEventTemplate,
  getOperatorEvent,
  pickAndUploadEventImage,
  saveEventTemplate,
  setOperatorEventCoords,
  updateOperatorEvent,
  type OperatorEventFields,
} from '../../lib/creatorEvents';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// doc 78 law 2 / doc 80 section D: a real drop-zone, not a pill over
// emptiness. The ratio is LOCKED at portrait 4:5 and read from the one
// shared constant, so cover surfaces can never disagree.
const FORM_HORIZONTAL_PADDING = 40;
const POSTER_ASPECT = COVER_ASPECT;
const POSTER_HEIGHT = Math.round((SCREEN_WIDTH - FORM_HORIZONTAL_PADDING) / POSTER_ASPECT);

// law 19: long enough that typing does not thrash the RPC, short enough
// that an organizer never loses gallery or body work to a refresh
const AUTOSAVE_DEBOUNCE_MS = 1500;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' <-> the calendar's CalendarDay (month 0-based). */
function parseDateString(s: string): CalendarDay | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null;
}

export default function EventFormScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, duplicateFrom, templateId, openPhotos } = useLocalSearchParams<{ id?: string; duplicateFrom?: string; templateId?: string; openPhotos?: string }>();
  const editing = !!id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // proposal 77: the form owns the rich body so it saves inside the
  // complete field set; undefined until an edit seeds it
  const [blocks, setBlocks] = useState<DescriptionBlock[] | undefined>(undefined);
  const [imageUrl, setImageUrl] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // §3.3 end: its own LA wall date + time, composed into end_time on save.
  // endDate defaults to the start day for a same-day event when left blank.
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  // proposal 35: the place pick's coordinates. Typing in venue or address by
  // hand clears them (a hand-typed place makes the old pin a lie); they ride
  // their own RPC after create/save, never the full-overwrite payload.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // §3.4 (d): a place was chosen but geocoding returned no lat/lng
  const [geocodeMissed, setGeocodeMissed] = useState(false);
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
  // §3.0 preview: a dedicated in-flight flag so a double-tap cannot fire two
  // draft-creates, without touching the main save button's spinner
  const [previewing, setPreviewing] = useState(false);
  // 7-27 ship ruling item 2: tapping photos/video on a brand-new form saves
  // the draft in place (the preview flow's proven move) instead of sitting
  // disabled; its own flag so a double-tap cannot fire two draft-creates
  const [unlockingMedia, setUnlockingMedia] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'problem'>('idle');

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

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
      // same event, same place: the pin travels with the duplicate
      if (existing.latitude != null && existing.longitude != null) {
        setCoords({ lat: existing.latitude, lng: existing.longitude });
      }
      setGeocodeMissed(false);
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
        // seed on the LA clock, never the device clock: getHours() on a
        // non-LA phone shifted the stored time on every untouched re-save
        // (the LA-date bug family)
        const wall = getLAWallParts(existing.start_time);
        if (wall) setTime(`${pad2(wall.hour24)}:${pad2(wall.minute)}`);
      }
      if (existing.end_time) {
        // the end instant rehydrates to the SAME LA wall day + time it was
        // composed from, so a multi-day end survives an untouched re-save
        const ew = getLAWallParts(existing.end_time);
        if (ew) {
          setEndDate(`${ew.y}-${pad2(ew.m + 1)}-${pad2(ew.d)}`);
          setEndTime(`${pad2(ew.hour24)}:${pad2(ew.minute)}`);
        }
      }
      setVenue(existing.venue);
      setVenueAddress(existing.venue_address);
      if (existing.latitude != null && existing.longitude != null) {
        setCoords({ lat: existing.latitude, lng: existing.longitude });
      }
      setCategory(existing.category);
      setExternalUrl(existing.external_url);
      setTicketPrice(existing.ticket_price);
      setPublicName(existing.public_name);
      setPinToChat(existing.pin_to_chat);
      // proposal 77: seed the stored body so an untouched save round-trips
      // it unchanged rather than clearing it
      setBlocks(existing.description_blocks ?? []);
      setEventStatus(existing.status);
      setEventCommunityId(existing.community_id);
      setSeeded(true);
    }
  }, [editing, existing, seeded]);

  const showError = (t: string, m: string) => setAlertInfo({ title: t, message: m });

  // requireDate: anything headed for Live insists on a real upcoming date,
  // exactly like category (the tour published a dateless event straight to
  // Live; doc 34 3.3 adds the past-date guard). Drafts and templates stay
  // dateless-legal, and cancel/complete never blocks on it.
  const collectFields = (opts?: { requireDate?: boolean; silent?: boolean }): OperatorEventFields | null => {
    // law 20 + law 19: a background save must never red-flag a field the
    // organizer is still filling in, so silent mode returns null quietly
    const complain = (heading: string, body: string) => {
      if (!opts?.silent) showError(heading, body);
    };
    if (!title.trim()) {
      complain('Almost', 'A title is required.');
      return null;
    }
    if (!category) {
      // mirrors the server guard ("Pick a category."), caught here first
      complain('Almost', 'Pick a category.');
      return null;
    }
    if (opts?.requireDate && !date.trim()) {
      // mirrors the proposed server guard ("Pick a date."), caught here first
      complain('Almost', 'Pick a date.');
      return null;
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      complain('Check the date', 'Use the YYYY-MM-DD shape, like 2026-07-20.');
      return null;
    }
    if (opts?.requireDate && date) {
      const day = parseDateString(date);
      if (day && isBeforeTodayLA(day.year, day.month, day.day)) {
        // LIZ COPY: the calendar refuses past days; this catches a stale
        // seeded date on its way to Live
        complain('Check the date', 'That day already happened. Pick one coming up.');
        return null;
      }
    }
    if (time && !/^\d{2}:\d{2}$/.test(time.trim())) {
      complain('Check the time', 'Use the HH:MM shape, like 19:30.');
      return null;
    }
    let startTime: string | null = null;
    if (date && time) {
      // the typed date and time are LA wall clock; pin them there instead of
      // letting the device zone reinterpret them (the LA-date bug family)
      const dm = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const tm = time.trim().match(/^(\d{2}):(\d{2})$/);
      if (!dm || !tm) {
        complain('Check the date and time', 'That combination did not parse.');
        return null;
      }
      startTime = laWallTimeToUTC(
        Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]),
        Number(tm[1]), Number(tm[2]),
      ).toISOString();
    }
    // §3.3 end: optional, but if an end time is set it composes against the
    // end day (or the start day for a same-day event) and must sit AFTER the
    // start. end_time feeds the payout-release wall, so a nonsense window can
    // never reach the money path.
    let endTimeIso: string | null = null;
    if (endTime.trim()) {
      const etm = endTime.trim().match(/^(\d{2}):(\d{2})$/);
      if (!etm) {
        complain('Check the end time', 'Use the HH:MM shape, like 22:30.');
        return null;
      }
      if (!startTime) {
        // an end with no start instant is ambiguous; anchor it to a start
        complain('Almost', 'set the start date and time before the end.');
        return null;
      }
      const endDayStr = endDate.trim() || date.trim();
      const edm = endDayStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!edm) {
        complain('Check the end date', 'Use the YYYY-MM-DD shape, like 2026-07-20.');
        return null;
      }
      const endInstant = laWallTimeToUTC(
        Number(edm[1]), Number(edm[2]) - 1, Number(edm[3]),
        Number(etm[1]), Number(etm[2]),
      );
      if (endInstant.getTime() <= new Date(startTime).getTime()) {
        // LIZ COPY: lowercase warm, and it names the fix
        complain('Check the end', 'it ends before it starts. pick a later time.');
        return null;
      }
      endTimeIso = endInstant.toISOString();
    }
    return {
      title,
      description,
      image_url: imageUrl,
      event_date: date.trim(),
      start_time: startTime,
      end_time: endTimeIso,
      venue,
      venue_address: venueAddress,
      category,
      external_url: externalUrl,
      ticket_price: ticketPrice,
      public_name: publicName,
      pin_to_chat: pinToChat,
      // proposal 77: the rich body rides the same full-overwrite payload.
      // undefined (create, or an edit that never opened the editor) leaves
      // the stored body untouched; [] clears it.
      description_blocks: blocks,
    };
  };

  const afterSave = () => {
    queryClient.invalidateQueries({ queryKey: ['creator-events-tab'] });
    queryClient.invalidateQueries({ queryKey: ['operator-event', id] });
  };

  // proposal 35: persist (or clear) the pick's coordinates after the row
  // saves. Best-effort by design, a pin never blocks a save; a fresh row
  // with no pick has nothing to store or clear, so skip the round trip.
  const syncCoords = async (eventId: string) => {
    if (!editing && !coords) return;
    try {
      await setOperatorEventCoords(eventId, coords?.lat ?? null, coords?.lng ?? null);
    } catch {
      // the event saved; the pin can be re-picked on the next edit
    }
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
    const fields = collectFields({ requireDate: true });
    if (!fields || saving) return;
    setSaving(true);
    try {
      if (editing && id) {
        await updateOperatorEvent(id, fields, null);
        await syncCoords(id);
        hapticSuccess();
        afterSave();
        router.back();
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        const newId = await createOperatorEvent(fields, communityId);
        await syncCoords(newId);
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

  // law 19: autosave drafts continuously with a visible saved state, and
  // NEVER let autosave publish. It only ever runs on an existing DRAFT
  // and always passes status null, so a Live event is never touched
  // behind the organizer's back and a draft is never flipped live.
  // law 19: the review checklist. Nudges, not blockers - a draft can
  // always publish with items unticked.
  const reviewItems = [
    { label: 'a poster', done: !!imageUrl },
    { label: 'a date', done: !!date.trim() },
    { label: 'where it is', done: !!venue.trim() },
    { label: 'photos or a story', done: (blocks?.length ?? 0) > 0 },
  ];

  const autosaveSignature = JSON.stringify([
    title, description, imageUrl, date, time, endDate, endTime, venue, venueAddress,
    category, ticketPrice, publicName, pinToChat, blocks,
  ]);
  const lastSavedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!isDraft || !id || saving || !seeded) return;
    if (lastSavedRef.current === null) {
      lastSavedRef.current = autosaveSignature;
      return;
    }
    if (lastSavedRef.current === autosaveSignature) return;
    const handle = setTimeout(async () => {
      const fields = collectFields({ silent: true });
      if (!fields) return;
      try {
        setAutosaveState('saving');
        await updateOperatorEvent(id, fields, null);
        lastSavedRef.current = autosaveSignature;
        setAutosaveState('saved');
      } catch {
        // never a blocking alert on a background save; the explicit save
        // button remains the honest path and will surface the real error
        setAutosaveState('problem');
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveSignature, isDraft, id, saving, seeded]);
  const handleSaveDraft = async () => {
    const fields = collectFields();
    if (!fields || saving) return;
    setSaving(true);
    try {
      if (editing && id) {
        await updateOperatorEvent(id, fields, null);
        await syncCoords(id);
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        const newId = await createOperatorEvent(fields, communityId, false);
        await syncCoords(newId);
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
    const fields = collectFields({ requireDate: true });
    if (!fields || !id || saving) return;
    setSaving(true);
    try {
      // the P3 selling gate: a draft with a PAID tier cannot go Live until
      // both Stripe capabilities exist. eventHasPaidTier throws on a failed
      // read, so a flaky check blocks the publish (fail closed) instead of
      // letting paid tickets ship without payout rails. Free-only and
      // un-ticketed events publish as before.
      if (await eventHasPaidTier(id)) {
        const { data: { user } } = await supabase.auth.getUser();
        const payout = user ? await getMyPayoutState(user.id) : null;
        if (!isPayoutReady(payout)) {
          showError(
            /* copy to the taste gate */
            'payouts first',
            'this event has a paid ticket. finish payout setup on the tickets screen and publish right after.',
          );
          return;
        }
      }
      await updateOperatorEvent(id, fields, 'Live');
      await syncCoords(id);
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
          // muted confirm, never red (C13); the web console matches
          text: status === 'Cancelled' ? 'cancel it' : 'complete it',
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

  // 7-27 ship ruling item 2: media needs a saved event id (the folder pin),
  // so the photos/video pills on a NEW form run this instead of sitting
  // disabled: a VISIBLE draft-create through the same createOperatorEvent
  // as "save as a draft", then the replace makes this screen the draft
  // editor with openPhotos=1 re-opening the picker. Missing title/category
  // surfaces as the RPC's own message, which names exactly what is needed.
  const handleUnlockMedia = async (kind: 'photos' | 'video') => {
    if (saving || previewing || unlockingMedia) return;
    const fields = collectFields();
    if (!fields) return;
    hapticLight();
    setUnlockingMedia(true);
    try {
      setAutosaveState('saving');
      const communityId = fromCommunity && community ? community.id : null;
      const newId = await createOperatorEvent(fields, communityId, false);
      await syncCoords(newId);
      setAutosaveState('saved');
      // openPhotos only for the photos tap: the video uploader is its own
      // multi-stage flow, so it is re-tapped rather than auto-launched
      const suffix = kind === 'photos' ? '&openPhotos=1' : '';
      router.replace(`/creator/event-form?id=${newId}${suffix}` as never);
    } catch (e) {
      setAutosaveState('problem');
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setUnlockingMedia(false);
    }
  };

  // §3.0 phone: "preview as guest" opens the real public renderer at
  // /event/[id]?preview=guest (organizer-gated there). The event needs an id to
  // navigate to, and the save must be VISIBLE (autosave's savedLine), never
  // silent - a row made on the user's behalf without them seeing it is the same
  // failure class as a defaulted policy they never chose.
  const handlePreview = async () => {
    // re-entry guard: a double-tap on a brand-new create must not fire two
    // draft-creates (a duplicate). previewing is dedicated so the main CTA's
    // spinner is left alone.
    if (saving || previewing) return;
    // draft-legal field set; a missing title/category surfaces here so we never
    // preview an event the public renderer cannot load
    const fields = collectFields();
    if (!fields) return;
    hapticLight();
    setPreviewing(true);
    try {
    if (id) {
      // an existing DRAFT is safe to flush so the preview is current; a LIVE
      // event must never be mutated by a preview tap, so it previews its saved
      // (published) state as-is (the accepted saved-state fidelity call)
      if (isDraft) {
        try {
          setAutosaveState('saving');
          await updateOperatorEvent(id, fields, null);
          await syncCoords(id);
          setAutosaveState('saved');
        } catch {
          setAutosaveState('problem');
        }
      }
      router.push(`/event/${id}?preview=guest` as never);
      return;
    }
    // NEW CREATE: no autosave runs until a draft exists, so there is nothing to
    // flush here - this is a VISIBLE first draft-create through the SAME
    // createOperatorEvent that "save as a draft" uses (not a new writer). The
    // replace then makes this screen the draft editor, so a later publish
    // updates that draft instead of creating a duplicate.
    const communityId = fromCommunity && community ? community.id : null;
    try {
      setAutosaveState('saving');
      const newId = await createOperatorEvent(fields, communityId, false);
      await syncCoords(newId);
      setAutosaveState('saved');
      router.replace(`/creator/event-form?id=${newId}` as never);
      router.push(`/event/${newId}?preview=guest` as never);
    } catch (e) {
      setAutosaveState('problem');
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    }
    } finally {
      setPreviewing(false);
    }
  };

  const loadingEdit = (editing || !!duplicateFrom) && !seeded;

  // The pickers speak CalendarDay and 12-hour parts; the form's canonical
  // state stays the RPC shapes ('YYYY-MM-DD' and 'HH:MM', LA wall clock),
  // so the laWallTimeToUTC pipeline below is untouched (doc 34 3.1).
  const parsedDay = parseDateString(date);
  const dayIsPast = !!parsedDay && isBeforeTodayLA(parsedDay.year, parsedDay.month, parsedDay.day);
  const timeMatch = time.trim().match(/^(\d{2}):(\d{2})$/);
  const hour24 = timeMatch ? Number(timeMatch[1]) : 19;
  const timeHour = ((hour24 + 11) % 12) + 1;
  const timeMinute = timeMatch ? timeMatch[2] : '00';
  const timePeriod: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';

  // §3.3 end pickers, mirroring the start. An empty end day falls back to the
  // start day at compose time, so a same-day event never needs a second date.
  const parsedEndDay = parseDateString(endDate);
  const endDayIsPast = !!parsedEndDay && isBeforeTodayLA(parsedEndDay.year, parsedEndDay.month, parsedEndDay.day);
  const endTimeMatch = endTime.trim().match(/^(\d{2}):(\d{2})$/);
  const endHour24 = endTimeMatch ? Number(endTimeMatch[1]) : 21;
  const endTimeHour = ((endHour24 + 11) % 12) + 1;
  const endTimeMinute = endTimeMatch ? endTimeMatch[2] : '00';
  const endTimePeriod: 'AM' | 'PM' = endHour24 >= 12 ? 'PM' : 'AM';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          {!loadingEdit && (
            /* §3.0 phone: persistent "preview as guest" (LIZ COPY, taste gate) */
            <TouchableOpacity onPress={handlePreview} disabled={saving || previewing} hitSlop={12}>
              <Text style={styles.previewAction}>preview as guest</Text>
            </TouchableOpacity>
          )}
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
            {autosaveState !== 'idle' && (
              /* law 19: the organizer can SEE that their work is safe. Shown for
                 draft autosave AND for a preview-triggered save on a new create,
                 so a row is never written on their behalf silently */
              <Text style={[styles.savedLine, autosaveState === 'problem' && styles.savedLineProblem]}>
                {/* copy to the taste gate */}
                {autosaveState === 'saving'
                  ? 'saving…'
                  : autosaveState === 'saved'
                    ? 'saved just now'
                    : 'not saved yet. your work is still here.'}
              </Text>
            )}

            {editing && eventStatus !== 'Live' && (
              /* LIZ COPY */
              <Text style={styles.statusLine}>
                {eventStatus === 'Draft'
                  ? 'a draft. only you see it until you publish.'
                  : `this event is ${eventStatus.toLowerCase()}.`}
              </Text>
            )}

            {/* §3 canvas: this is not a form of grey boxes, it is a PAGE being
                built. The top half is the page itself, media-led (doc 80: the
                cover is the one warm-dark surface, so it reads as the face of a
                page, not a field); the logistics follow as quieter cards. */}

            {/* §3.1 cover: the page's face, a real 4:5 warm-dark drop-zone */}
            {imageUrl ? (
              <TouchableOpacity onPress={handlePoster} disabled={uploading} activeOpacity={0.9}>
                <Image source={{ uri: imageUrl }} style={styles.cover} contentFit="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.coverAdd} onPress={handlePoster} disabled={uploading} activeOpacity={0.9}>
                {uploading ? (
                  <ActivityIndicator size="small" color={EventSurface.onMedia} />
                ) : (
                  <>
                    <Plus size={30} color={EventSurface.onMedia} strokeWidth={2.5} />
                    {/* copy to the taste gate (§3.1 empty state) */}
                    <Text style={styles.coverAddLabel}>add your cover</Text>
                    {/* copy to the taste gate */}
                    <Text style={styles.coverAddHint}>portrait {COVER_ASPECT_LABEL}. it fronts the card and the page.</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* §3.2 title: a name, not a form field (shared editorial field) */}
            <EditorialTitleField
              value={title}
              onChangeText={setTitle}
              placeholder="sunset rooftop social"
              label="title"
              maxLength={120}
            />

            {/* §3.2 summary: ONE warm line, sized to what it is */}
            <Text style={styles.fieldLabel}>the one-liner</Text>
            <Text style={styles.fieldHint}>the first warm line people read on your page.</Text>
            <TextInput
              style={styles.summaryInput}
              value={description}
              onChangeText={setDescription}
              maxLength={140}
              placeholder="one warm line people read first"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* §3.2 mood-board body: PRESENT and obvious on create and edit, not
                hidden behind an edit-only pill. Text and faq blocks ride the
                create/save payload and work immediately; photos and video upload
                into the event's own folder, so they wake once a draft exists. */}
            <Text style={styles.fieldLabel}>the page itself</Text>
            <Text style={styles.fieldHint}>photos, the story between them, and your good-to-know cards. this is the body of your page.</Text>
            <DescriptionBlocksEditor
              onUnlockMedia={!id ? handleUnlockMedia : undefined}
              autoOpenPhotos={openPhotos === '1'}
              eventId={id ?? ''}
              blocks={blocks ?? []}
              onChange={setBlocks}
              canAddMedia={!!id}
              /* copy to the taste gate */
              mediaHint="photos and video save your draft first, on their own."
            />

            <View style={styles.zoneDivider} />

            <Text style={styles.sectionHeader}>when</Text>
            <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel}>date</Text>
            {/* the calendar refuses past days; a stored past date shows in
                the placeholder instead of pinning the calendar to a month it
                can never leave (doc 34 3.1 + 3.3) */}
            <View style={styles.pickerBlock}>
              <CollapsibleCalendar
                selected={dayIsPast ? null : parsedDay}
                onSelect={(d) => setDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                /* LIZ COPY */
                placeholder={dayIsPast ? `it was ${formatEventDateLA(date.trim())}. pick a new day` : 'pick a day'}
              />
            </View>

            <View style={styles.pickerBlock}>
              <TimePicker
                hour={timeHour}
                minute={timeMinute}
                period={timePeriod}
                selected={!!timeMatch}
                onChange={(hour, minute, period) => {
                  const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                  setTime(`${pad2(h)}:${minute}`);
                }}
              />
              {!!timeMatch && (
                <TouchableOpacity onPress={() => { hapticLight(); setTime(''); }} hitSlop={8}>
                  {/* LIZ COPY: a set time stays optional, so it must be removable */}
                  <Text style={styles.clearTimeLink}>no set time</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.fieldLabel}>ends</Text>
            {/* copy to the taste gate (§3.3): optional, but the end feeds the
                payout-release wall on paid events, so it is worth setting. a
                blank end day means the same day as the start. */}
            <Text style={styles.fieldHint}>optional. sets when it wraps, and when a paid event's payout releases.</Text>
            <View style={styles.pickerBlock}>
              <CollapsibleCalendar
                selected={endDayIsPast ? null : parsedEndDay}
                onSelect={(d) => setEndDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                /* LIZ COPY: a blank end day is the same day as the start */
                placeholder={endDayIsPast ? `it was ${formatEventDateLA(endDate.trim())}. pick a new day` : 'same day, or pick another'}
              />
            </View>
            <View style={styles.pickerBlock}>
              <TimePicker
                hour={endTimeHour}
                minute={endTimeMinute}
                period={endTimePeriod}
                selected={!!endTimeMatch}
                onChange={(hour, minute, period) => {
                  const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                  setEndTime(`${pad2(h)}:${minute}`);
                }}
              />
              {!!endTimeMatch && (
                <TouchableOpacity onPress={() => { hapticLight(); setEndTime(''); setEndDate(''); }} hitSlop={8}>
                  {/* LIZ COPY: an end stays optional, so it must be removable */}
                  <Text style={styles.clearTimeLink}>no end time</Text>
                </TouchableOpacity>
              )}
            </View>

            </View>

            <Text style={styles.sectionHeader}>where</Text>
            <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel}>search for it</Text>
            {/* the search fills venue and address and pins the coordinates
                (proposal 35); the fields below stay editable, and typing in
                them by hand drops the pin so it never lies */}
            <EventPlaceSearch
              onPick={(p) => {
                setVenue(p.venue);
                setVenueAddress(p.address);
                const hit = p.lat != null && p.lng != null;
                setCoords(hit ? { lat: p.lat!, lng: p.lng! } : null);
                // §3.4 (d): a chosen place with no coordinates is a miss,
                // not an empty field
                setGeocodeMissed(!hit);
              }}
            />

            {/* §3.4 (b/c/d): the tile+pin the canvas was missing */}
            <EventLocationMap coords={coords} geocodeMissed={geocodeMissed} />

            <Text style={styles.fieldLabel}>venue</Text>
            <TextInput
              style={styles.input}
              value={venue}
              onChangeText={(v) => { setVenue(v); setCoords(null); setGeocodeMissed(false); }}
              maxLength={120}
              /* copy to the taste gate */
              placeholder="the spot's name"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <Text style={styles.fieldLabel}>address</Text>
            <TextInput
              style={styles.input}
              value={venueAddress}
              onChangeText={(v) => { setVenueAddress(v); setCoords(null); setGeocodeMissed(false); }}
              maxLength={200}
              /* copy to the taste gate */
              placeholder="street, city"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            </View>

            <Text style={styles.sectionHeader}>the details</Text>
            <View style={styles.sectionCard}>
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

            {/* the tickets-link field is GONE per the 7-20 ruling: no
                external ticket links at launch, ticketing runs through
                washedup (doc 61 §1.2). The externalUrl state stays as a
                silent pass-through so existing events' stored links
                survive an edit-save untouched. */}

            <Text style={styles.fieldLabel}>ticket price</Text>
            <TextInput style={styles.input} value={ticketPrice} onChangeText={setTicketPrice} placeholder="leave empty if free" placeholderTextColor={Colors.inkSoft} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />

            <Text style={styles.fieldLabel}>public listing name</Text>
            <Text style={styles.fieldHint}>a brand or venue name to front the listing. leave empty to show yours.</Text>
            <TextInput style={styles.input} value={publicName} onChangeText={setPublicName} maxLength={80} placeholder="a brand or venue name" placeholderTextColor={Colors.inkSoft} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
            </View>

            <Text style={styles.sectionHeader}>who puts it on</Text>
            <View style={styles.sectionCard}>
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
            </View>

            {isDraft && (
              <View style={styles.reviewCard}>
                {/* copy to the taste gate: a friendly checklist, and every
                    missing item is a NUDGE, never a blocker (law 19) */}
                <Text style={styles.reviewTitle}>before it goes up</Text>
                {reviewItems.map((item) => (
                  <View key={item.label} style={styles.reviewRow}>
                    <Check
                      size={14}
                      color={item.done ? Colors.brandDeep : Colors.border}
                      strokeWidth={2.5}
                    />
                    <Text style={[styles.reviewItem, item.done && styles.reviewItemDone]}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  previewAction: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  statusLine: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary, marginBottom: 12 },
  savedLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2, marginBottom: 12 },
  savedLineProblem: { color: EventAction.error },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.xs,
    marginTop: EventSpacing.lg,
    marginBottom: EventSpacing.md,
  },
  reviewTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.text1, marginBottom: EventSpacing.xs },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: EventSpacing.sm },
  reviewItem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2 },
  reviewItemDone: { color: Colors.brandDeep },
  // doc 76 §3: sections carry the rhythm; labels stop shouting
  // terracotta on every field and go quiet and tracked
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    paddingBottom: 4,
  },
  fieldLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginBottom: 6,
  },
  fieldHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.parchment,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 18,
  },
  // §3.2 summary lives in the open cream page-zone, so it carries a white
  // card surface to stay legible (the logistics inputs sit on white cards
  // already and keep the parchment fill)
  summaryInput: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 18,
  },
  pickerBlock: { marginBottom: 14 },
  clearTimeLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  // §3.1 cover: the page's face. doc 80 makes media the ONE warm-dark
  // surface, so the empty drop-zone is dark cream-on-warm, reading as the
  // hero of a page rather than another grey form field.
  cover: { width: '100%', height: POSTER_HEIGHT, borderRadius: 16, marginBottom: EventSpacing.md },
  coverAdd: {
    height: POSTER_HEIGHT,
    borderRadius: 16,
    backgroundColor: EventSurface.media,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: EventSpacing.md,
    gap: 8,
    paddingHorizontal: 24,
  },
  coverAddLabel: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: EventSurface.onMedia },
  coverAddHint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: EventSurface.onMediaMuted, textAlign: 'center' },
  // the seam between the open editorial page-zone and the logistics cards
  zoneDivider: { height: 1, backgroundColor: Colors.border, marginTop: EventSpacing.lg, marginBottom: EventSpacing.xs },
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
