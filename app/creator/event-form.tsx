import {getPageEventSaveState} from '../../lib/creatorPageEventSave';
import {RequestDeadlineError,requestWithDeadline} from '../../lib/requestWithDeadline';
import { eventCategories } from '../../lib/eventCategories';
import { CreatorEventCategoryFields } from '../../components/creator/pages/CreatorEventDraftFields';
import {useCreatorPageEventTemplate} from '../../hooks/useCreatorPageEventTemplate';
import CreatorEventEntryGate from '../../components/creator/pages/CreatorEventEntryGate';
import {mediaUUID} from '../../lib/creatorPageEventMedia';
import { EventMediaImage } from '../../components/events/EventMediaImage';
import {createPageEventMediaGuard} from '../../lib/eventMediaGuard';
import {useCreatorPageCover} from '../../hooks/useCreatorPageCover';
/**
 * Creator mode: post or edit an event (doc 08 events organ). Create asks
 * attribution once (from the community or just you, locked after, batch 15
 * call e). Free events publish immediately; ticketed events are created as
 * private drafts and continue through ticket and payout setup. Edit honors the
 * FULL-OVERWRITE contract: the form loads every field and always sends the
 * complete set (see lib/creatorEvents.ts). A community event offers "tell
 * your members" after publish, one-shot, never automatic. Functionally
 * minimal per decision 15a.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack, Redirect } from 'expo-router';
import { rememberSavedCreatorEvent } from '../../lib/creatorEventReturn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Check, Plus, ChevronRight } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { FontSizes, LineHeights, type AfterglowFontFamilies } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { GoldSurfaceFill } from '../../components/creator/GoldSurfaceFill';
import ProfileButton from '../../components/ProfileButton';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { DescriptionBlocksEditor } from '../../components/creator/DescriptionBlocksEditor';
import { type DescriptionBlock } from '../../lib/eventContent';
import { COVER_ASPECT, COVER_ASPECT_LABEL, EventAction, EventSpacing, EventSurface } from '../../constants/EventDesign';
import EditorialTitleField from '../../components/composer/EditorialTitleField';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import { formatEventDateLA, getLAWallParts, isBeforeTodayLA, isValidLAWallTime, laWallTimeToUTC } from '../../lib/laDate';
import CollapsibleCalendar from '../../components/composer/CollapsibleCalendar';
import TimePicker from '../../components/composer/TimePicker';
import { type CalendarDay } from '../../components/calendar/WashedUpCalendar';
import EventPlaceSearch from '../../components/creator/EventPlaceSearch';
import { EventLocationMap } from '../../components/creator/EventLocationMap';
import { getCreatorAccess, canManageEvents, creatorLandingRoute } from '../../lib/creatorMode';
import { CO_CREATOR_INVITES_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { useWorkspace } from '../../lib/workspaceContext';
import { supabase } from '../../lib/supabase';
import { getMyPayoutState, getTiers, isPayoutReady, getRefundAccess, refundLiveOrdersOnCancel, type CancelRefundSummary } from '../../lib/ticketing';
import { OFFER_TYPE_OPTIONS, isOfferTypeSellableToday, isOfferType, type OfferType } from '../../lib/offerTypes';
import { runPaidTicketSetupHandoff } from '../../lib/paidTicketFlow';
import {
  announceEventToMembers as existingAnnounceEventToMembers,
  createOperatorEvent,
  EVENT_CATEGORIES,
  getEventTemplate,
  getOperatorEvent,
  pickAndUploadEventImage,
  probeConfirmationMessage,
  probeOfferType,
  probeTicketCapacityRpc,
  saveEventTemplate as existingSaveEventTemplate,
  setEventOfferType as existingSetEventOfferType,
  setEventTicketCapacity as existingSetEventTicketCapacity,
  setOperatorEventCoords as existingSetOperatorEventCoords,
  updateOperatorEvent as updateExistingOperatorEvent,
  type OperatorEventFields,
  type OperatorEventRow,
} from '../../lib/creatorEvents';

import { useCreatorPageEventStatus } from '../../hooks/useCreatorPageEventStatus';
import { assertPageEventStatusAccount, type PageEventStatus } from '../../lib/creatorPageEventStatus';
import { useCreatorPageEventSave } from '../../hooks/useCreatorPageEventSave';
import { loadCreatorPageEventReadiness, pageEventPublishGuidance } from '../../lib/creatorPageEventReadiness';
import CreatorPageEventGate from '../../components/creator/pages/CreatorPageEventGate';
import { publishCreatorPageEvent, CreatorPageScopeExpired, type CreatorPageScope } from '../../lib/creatorPageReview';
import type { CreatorPageEventContext } from '../../lib/creatorPageEventContext';

// doc 78 law 2 / doc 80 section D: a real drop-zone, not a pill over
// emptiness. The ratio is LOCKED at portrait 4:5 and read from the one
// shared constant, so cover surfaces can never disagree.
const POSTER_ASPECT = COVER_ASPECT;

// law 19: long enough that typing does not thrash the RPC, short enough
// that an organizer never loses gallery or body work to a refresh
const AUTOSAVE_DEBOUNCE_MS = 1500;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' <-> the calendar's CalendarDay (month 0-based). */
function parseDateString(s: string): CalendarDay | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null;
}

export default function EventFormRoute() {
  const { pageId, id, team, duplicateFrom, templateId, openPhotos, returnToTickets } = useLocalSearchParams<{ pageId?: string; id?: string; team?: string; duplicateFrom?: string; templateId?: string; openPhotos?: string; returnToTickets?: string }>();
  if (pageId !== undefined || team !== undefined) {
    const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
    if (!CREATOR_PAGES_ENABLED || !uuid(pageId) || !uuid(id) || (team !== undefined && team !== '1')) {
      return <Redirect href="/(tabs)/friends" />;
    }
    return <CreatorPageEventGate pageId={pageId} eventId={id} team={team === '1'}>
      {(page, scope, event) => <EventFormScreen pageContext={page} pageScope={scope} pageEvent={event} />}
    </CreatorPageEventGate>;
  }
  if (CREATOR_PAGES_ENABLED && (id !== undefined || duplicateFrom !== undefined || templateId !== undefined)) {
    const kind = id !== undefined ? 'edit' : duplicateFrom !== undefined ? 'duplicate' : 'template';
    const selected = id ?? duplicateFrom ?? templateId;
    if (!mediaUUID(selected)) return <Redirect href="/(tabs)/friends" />;
    return <CreatorEventEntryGate intent={{kind, id: selected}} openPhotos={openPhotos === '1'} returnToTickets={returnToTickets === '1'}><EventFormScreen /></CreatorEventEntryGate>;
  }
  return <EventFormScreen />;
}

function EventFormScreen({ pageContext, pageScope, pageEvent }: { pageContext?: CreatorPageEventContext; pageScope?: CreatorPageScope; pageEvent?: OperatorEventRow }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => eventFormStyles(fonts), [fonts]);
  const appearance = useMemo(() => ({ fonts, sunset: true }), [fonts]);
  // A page context comes only from the authorized saved-page/event gate, never route text.
  const assertPageVisit = () => { if (pageScope && !pageScope.isCurrent()) throw new CreatorPageScopeExpired(); };
  const withPageScope = async <T,>(action: () => Promise<T>, readOnly = false): Promise<T> => {
    assertPageVisit();
    if (pageScope && (publicationUncertain.current || !pageSave.canWrite() || !pageStatus.canWrite() || !pageTemplate.canEdit()) && !readOnly) throw new Error('Check the saved event status before continuing.');
    if (pageScope) {
      const { data: { user }, error } = await supabase.auth.getUser();
      assertPageVisit();
      if (error) throw error;
      if (user?.id !== pageScope.userId) throw new CreatorPageScopeExpired();
      if (!readOnly && (!pageSave.canWrite() || !pageStatus.canWrite() || !pageTemplate.canEdit())) throw new Error('Check the complete event save before continuing.');
    }
    const result = await action();
    assertPageVisit();
    return result;
  };
  const updateOperatorEvent: typeof updateExistingOperatorEvent = (...args) => withPageScope(() => updateExistingOperatorEvent(...args));
  const setOperatorEventCoords: typeof existingSetOperatorEventCoords = (...args) => withPageScope(() => existingSetOperatorEventCoords(...args));
  const setEventOfferType: typeof existingSetEventOfferType = (...args) => withPageScope(() => existingSetEventOfferType(...args));
  const setEventTicketCapacity: typeof existingSetEventTicketCapacity = (...args) => withPageScope(() => existingSetEventTicketCapacity(...args));
  const announceEventToMembers: typeof existingAnnounceEventToMembers = (...args) => withPageScope(() => existingAnnounceEventToMembers(...args));
  const router = useRouter();
  const leaveEditor = () => {
    if (!router.canGoBack() && returnToTickets === '1' && id) router.replace(`/creator/tickets?id=${id}` as never);
    else if (pageContext && !router.canGoBack()) router.replace((pageContext.entry === 'team' ? `/creator/page-events?id=${pageContext.pageId}` : `/creator/page?id=${pageContext.pageId}`) as never);
    else router.back();
  };
  const queryClient = useQueryClient();
  const { id, duplicateFrom, templateId, openPhotos, returnToTickets } = useLocalSearchParams<{ id?: string; duplicateFrom?: string; templateId?: string; openPhotos?: string; returnToTickets?: string }>();
  const editing = !!id;
  const pageSave = useCreatorPageEventSave(pageContext?.pageId, id, pageScope);
  const editorScroll = React.useRef<ScrollView>(null);
  const pageStatus = useCreatorPageEventStatus(pageContext?.pageId, id, pageScope);
  const pageTemplate = useCreatorPageEventTemplate(pageContext?.pageId, id, pageScope);
  const pageTemplateBlocked = () => !!pageContext && !pageTemplate.canEdit();
  const pageStatusWritable = !pageContext || pageStatus.canWrite() && pageTemplate.ready;
  const mediaWritable=React.useRef<()=>boolean>(()=>false);
  mediaWritable.current=()=>!publicationUncertain.current&&!explicitSaveRef.current&&pageSave.canWrite()&&pageStatus.canWrite()&&pageTemplate.canEdit();
  const pageMediaGuard=React.useMemo(()=>pageContext&&id&&pageScope
    ? createPageEventMediaGuard(pageContext.pageId,id,pageScope,()=>mediaWritable.current(),async()=>{await autosaveInFlightRef.current?.catch(()=>undefined);}) : undefined,
    [pageContext?.pageId,id,pageScope]);
  const posterLock=React.useRef(false);

  const [pageSettingsSeeded, setPageSettingsSeeded] = useState(false);
  useEffect(() => {
    if (!pageContext || !pageSave.current || pageSettingsSeeded) return;
    if (isOfferType(pageSave.current.offerType)) setOfferType(pageSave.current.offerType);
    setOfferTypeColumnOpen(true);
    setAfterPurchaseOpen(true);
    setAfterPurchaseMsg(pageSave.current.fields.confirmation_message ?? '');
    setTicketCapacity(pageSave.current.ticketCapacity === null ? '' : String(pageSave.current.ticketCapacity));
    setTicketCapacityRpcOpen(pageSave.current.canManageTickets);
    setPageSettingsSeeded(true);
  }, [pageContext, pageSave.current, pageSettingsSeeded]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // proposal 77: the form owns the rich body so it saves inside the
  // complete field set; undefined until an edit seeds it
  const [blocks, setBlocks] = useState<DescriptionBlock[] | undefined>(undefined);
  const [imageUrl, setImageUrl] = useState('');
  const privateCover=useCreatorPageCover(pageContext?.pageId,id,pageScope,pageMediaGuard,setImageUrl,
    reference=>setImageUrl(current=>current===reference?(pageSave.current?.fields.image_url??''):current),pageSave.current?.fields.image_url);
  const bodyMediaWork=React.useRef<object|null>(null);
  const [bodyMediaBusy,setBodyMediaBusy]=useState(false);
  const beginBodyMediaWork=React.useCallback(()=>{
    if(posterLock.current||privateCover.isBusy()||bodyMediaWork.current||explicitSaveRef.current||pageTemplateBlocked())return null;
    const owned={};bodyMediaWork.current=owned;setBodyMediaBusy(true);
    return ()=>{if(bodyMediaWork.current===owned){bodyMediaWork.current=null;setBodyMediaBusy(false);}};
  },[privateCover.isBusy,pageTemplate.canEdit]);
  const coverInProgress=()=>!!pageContext&&(posterLock.current||privateCover.isBusy()||!!bodyMediaWork.current);
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
  // C-21: the RSVP cap, digits-only string for the input; '' = unlimited.
  // Rides its own RPC after create/save, never the full-overwrite payload
  // (same shape as coords).
  const [ticketCapacity, setTicketCapacity] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  // C-18: the four decided-sellable offer types only (lib/offerTypes.ts);
  // class_pack/subscription render as disabled "coming soon" chips, never
  // selectable. Defaults to ticketed_event, matching the draft migration's
  // own column default so behavior lines up whenever it eventually applies.
  const [offerType, setOfferType] = useState<OfferType>('ticketed_event');
  // join-gate door for offer_type (see lib/creatorEvents.ts probeOfferType):
  // true once the column is confirmed live. The picker itself always
  // renders -- it's real client-side logic either way -- this only gates
  // whether a save attempts to persist the pick.
  const [offerTypeColumnOpen, setOfferTypeColumnOpen] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [ticketPrice, setTicketPrice] = useState('');
  const [publicName, setPublicName] = useState('');
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);
  const workspace = useWorkspace(access);
  // New events follow the selected authorized workspace. Saved/template
  // ownership and an explicit selection still take precedence.
  const [chosenCommunity, setFromCommunity] = useState<boolean | null>(null);
  const fromCommunity = chosenCommunity ?? workspace !== 'organization';
  const selectedCategories=eventCategories({categories}, (pageContext ? pageContext.kind==='community' : fromCommunity));
  const category=selectedCategories[0]??'';
  const [pinToChat, setPinToChat] = useState(true);
  const [eventStatus, setEventStatus] = useState<string>('Live');
  const [eventCommunityId, setEventCommunityId] = useState<string | null>(null);
  // doc 111: the "after they buy" message. The field renders ONLY when the
  // SQL-96 column probe succeeds (join-gate pattern), so it self-flips on
  // apply and can never silently drop an organizer's text before then.
  const [afterPurchaseOpen, setAfterPurchaseOpen] = useState(false);
  const [afterPurchaseMsg, setAfterPurchaseMsg] = useState('');

  // doc 111 door probe: edit loads the stored message with it; create just
  // asks whether the column exists yet
  useEffect(() => {
    if (pageContext) return;
    probeConfirmationMessage(editing ? id : null).then(({ open, value }) => {
      setAfterPurchaseOpen(open);
      if (value !== null) setAfterPurchaseMsg(value);
    });
  }, [editing, id]);

  // C-18 door probe: same shape as the confirmation-message probe above.
  // A missing column reads as door-closed and offerType just stays at its
  // default; an edit on an already-tagged event seeds the real value.
  useEffect(() => {
    if (pageContext) return;
    probeOfferType(editing ? id : null).then(({ open, value }) => {
      setOfferTypeColumnOpen(open);
      if (value && isOfferType(value)) setOfferType(value);
    });
  }, [editing, id]);

  // C-21: the RSVP-cap field always renders (real client-side state either
  // way, same call as offer type's picker); this only gates whether a save
  // attempts the write RPC. Runs once -- the RPC's existence is not
  // per-event, unlike the probes above.
  const [ticketCapacityRpcOpen, setTicketCapacityRpcOpen] = useState(false);
  useEffect(() => {
    if (pageContext) return;
    probeTicketCapacityRpc().then(setTicketCapacityRpcOpen);
  }, []);

  // Build 42: ticketed offers must have a paid tier on sale before publish.
  // This state is refreshed whenever the form regains focus, including after
  // the organizer follows the setup door to the tickets screen and returns.
  // Review finding 2026-08-29: a plain useEffect never reran when a creator
  // followed this nudge to the tickets screen and came straight back, since
  // this screen stays mounted and none of the deps change -- useFocusEffect
  // re-checks every time the screen regains focus instead.
  const [ticketSetupState, setTicketSetupState] = useState<'not_needed' | 'checking' | 'missing' | 'draft' | 'ready'>('checking');
  useFocusEffect(
    useCallback(() => {
      if (!editing || !id || offerType !== 'ticketed_event') {
        setTicketSetupState('not_needed');
        return;
      }
      let cancelled = false;
      setTicketSetupState('checking');
      getTiers(id)
        .then((tiers) => {
          if (cancelled) return;
          const paid = tiers.filter((tier) => tier.price_cents > 0);
          setTicketSetupState(
            paid.length === 0 ? 'missing' : paid.some((tier) => tier.status === 'on_sale') ? 'ready' : 'draft',
          );
        })
        .catch(() => { if (!cancelled) setTicketSetupState('checking'); });
      return () => { cancelled = true; };
    }, [editing, id, offerType]),
  );
  const [seeded, setSeeded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pagePublicationUncertain, setPagePublicationUncertainState] = useState(false);
  const publicationUncertain = React.useRef(false);
  const setPagePublicationUncertain = (value: boolean) => { publicationUncertain.current = value; setPagePublicationUncertainState(value); };
  // §3.0 preview: a dedicated in-flight flag so a double-tap cannot fire two
  // draft-creates, without touching the main save button's spinner
  const [previewing, setPreviewing] = useState(false);
  // 7-27 ship ruling item 2: tapping photos/video on a brand-new form saves
  // the draft in place (the preview flow's proven move) instead of sitting
  // disabled; its own flag so a double-tap cannot fire two draft-creates
  const [unlockingMedia, setUnlockingMedia] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const scrollToRecovery = useCallback(() => {
    if (pageScope?.isCurrent() && (pageSave.error || pageSave.conflict || pageStatus.error || pageStatus.conflict || pageStatus.outcome || pageStatus.refundsNeedReview || pageStatus.retryReady || pageTemplate.error || pageTemplate.stale || pageTemplate.saved || pageTemplate.retired || pageTemplate.retryReady || pagePublicationUncertain)) editorScroll.current?.scrollTo({y: 0, animated: false});
  }, [pageScope, pageSave.error, pageSave.conflict, pageStatus.error, pageStatus.conflict, pageStatus.outcome, pageStatus.refundsNeedReview, pageStatus.retryReady, pageTemplate.error, pageTemplate.stale, pageTemplate.saved, pageTemplate.retired, pageTemplate.retryReady, pagePublicationUncertain]);
  useEffect(() => {
    if (alertInfo) return;
    const frame = requestAnimationFrame(scrollToRecovery);
    return () => cancelAnimationFrame(frame);
  }, [alertInfo, scrollToRecovery]);

  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'problem'>('idle');


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
      setCategories(eventCategories(f));
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
  const { data: queriedEvent } = useQuery({
    queryKey: ['operator-event', sourceId],
    queryFn: () => getOperatorEvent(sourceId!),
    enabled: !!sourceId && !pageContext,
  });

  const existing = pageContext
    ? pageSave.current && pageEvent ? { ...pageEvent, ...pageSave.current.fields, status: pageSave.current.status,
      latitude: pageSave.current.latitude, longitude: pageSave.current.longitude, ticket_capacity: pageSave.current.ticketCapacity } : undefined
    : queriedEvent;

  // the event's own room, if one exists yet -- same lookup app/event/[id].tsx
  // already uses. Only Live community events reliably have a topic row.
  const { data: eventTopicId = null } = useQuery({
    queryKey: ['event-topic', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('community_topics')
        .select('id')
        .eq('explore_event_id', id!)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    enabled: editing && !!eventCommunityId && !!id && eventStatus === 'Live',
    staleTime: 60_000,
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
      // C-21: same reasoning as the pin -- a duplicate of a capped event
      // starts capped the same way, the organizer can still change it
      setTicketCapacity(existing.ticket_capacity != null ? String(existing.ticket_capacity) : '');
      setCategories(eventCategories(existing));
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
      // C-21: the stored RSVP cap, if any
      setTicketCapacity(existing.ticket_capacity != null ? String(existing.ticket_capacity) : '');
      setCategories(eventCategories(existing));
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
      if (!isValidLAWallTime(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))) {
        complain('Choose another time', 'That date or time does not exist in Los Angeles. Pick a different time.');
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
      if (!isValidLAWallTime(Number(edm[1]), Number(edm[2]) - 1, Number(edm[3]), Number(etm[1]), Number(etm[2]))) {
        complain('Choose another end time', 'That date or time does not exist in Los Angeles. Pick a different time.');
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
      categories:selectedCategories,
      external_url: externalUrl,
      ticket_price: ticketPrice,
      public_name: publicName,
      pin_to_chat: pinToChat,
      // proposal 77: the rich body rides the same full-overwrite payload.
      // undefined (create, or an edit that never opened the editor) leaves
      // the stored body untouched; [] clears it.
      description_blocks: blocks,
      // doc 111: rides only when the SQL-96 door is open (undefined = the
      // param is never sent); the loaded value always travels back, so the
      // full-overwrite contract holds
      confirmation_message: afterPurchaseOpen ? (pageContext ? afterPurchaseMsg.trim() : afterPurchaseMsg.trim() || null) : undefined,
    };
  };

  const afterSave = () => {
    if (pageContext && pageScope && id) rememberSavedCreatorEvent(pageContext.pageId, id, pageScope);
    queryClient.invalidateQueries({ queryKey: ['creator-events-tab'] });
    queryClient.invalidateQueries({ queryKey: ['operator-event', id] });
  };

  // proposal 35: persist (or clear) the pick's coordinates after the row
  // saves. Best-effort by design, a pin never blocks a save; a fresh row
  // with no pick has nothing to store or clear, so skip the round trip.
  const syncCoords = async (eventId: string) => {
    if (pageContext) return; // The complete page save already includes coordinates.
    if (!editing && !coords) return;
    try {
      await setOperatorEventCoords(eventId, coords?.lat ?? null, coords?.lng ?? null);
    } catch {
      // the event saved; the pin can be re-picked on the next edit
    }
  };

  // C-18: best-effort, mirrors syncCoords -- a pin/offer-type save never
  // blocks the real event save. Only attempted once the door probe found
  // the column live; before that it would just fail on every save for no
  // reason, so skip the round trip entirely.
  const syncOfferType = async (eventId: string) => {
    if (pageContext) return; // Atomic page save owns this choice.
    if (!offerTypeColumnOpen) return;
    try {
      await setEventOfferType(eventId, offerType);
    } catch {
      // column or write grant not actually live yet; the event still saved
    }
  };

  // C-21: same best-effort shape, gated on probeTicketCapacityRpc rather
  // than a column probe (the column is already live; only the RPC might not
  // be -- see the probe's own comment in lib/creatorEvents.ts).
  const syncTicketCapacity = async (eventId: string) => {
    if (pageContext) return; // Atomic page save owns this choice.
    if (!ticketCapacityRpcOpen) return;
    try {
      await setEventTicketCapacity(eventId, ticketCapacity.trim() ? parseInt(ticketCapacity, 10) : null);
    } catch {
      // the RPC was probed open but this specific write still failed
      // (permissions, a bad value); the event itself still saved
    }
  };

  const saveEventFields = async (eventId: string, fields: OperatorEventFields, forTemplate = false) => {
    if (!pageContext) { await updateOperatorEvent(eventId, fields, null); return; }
    assertPageVisit();
    if (!forTemplate && pageTemplateBlocked()) throw new Error('Check the original template attempt before editing.');
    if (!pageSettingsSeeded || eventId !== id) throw new Error('Wait for this event’s saved settings before saving.');
    if (!pageStatus.canWrite()) throw new Error('Check the pending event action before editing.');
    const saved = await pageSave.save({ fields, offerType, ticketCapacity: ticketCapacity.trim() ? Number(ticketCapacity) : null,
      latitude: coords?.lat ?? null, longitude: coords?.lng ?? null });
    assertPageVisit();
    return saved;
  };

  const offerAnnounce = (eventId: string) => {
    // LIZ COPY (taste call 9): opt-in, never automatic
    setAlertInfo({
      title: 'tell your members?',
      message: 'a short note lands in their notifications. once per event.',
      buttons: [
        { text: 'not now', style: 'cancel', onPress: () => leaveEditor() },
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
            leaveEditor();
          },
        },
      ],
    });
  };

  /**
   * Audit finding 4: a partner can set up tiers, publish, share the link and
   * sell nothing, because tiers are born as drafts and buyers only ever see
   * on_sale ones. Publishing does not block on it (a free RSVP event is
   * legitimate), but it must never happen silently: if this event HAS
   * tickets and not one of them is on sale, say so plainly and offer the
   * one screen that fixes it.
   */
  const warnIfNothingOnSale = async (eventId: string, onDone: () => void) => {
    if (offerType !== 'ticketed_event') {
      onDone();
      return;
    }
    let tiers: Awaited<ReturnType<typeof getTiers>> = [];
    try {
      tiers = await getTiers(eventId);
    } catch {
      onDone();
      return;
    }
    const paidTiers = tiers.filter((tier) => tier.price_cents > 0);
    if (paidTiers.some((tier) => tier.status === 'on_sale')) {
      onDone();
      return;
    }
    setAlertInfo({
      /* copy to the taste gate */
      title: paidTiers.length === 0 ? 'add your ticket and price' : 'your tickets are still drafts',
      message: paidTiers.length === 0
        ? 'this is a ticketed event, but nobody can buy yet. add a paid ticket before it goes live.'
        : 'this event is up, but nobody can buy a ticket until you put one on sale.',
      buttons: [
        { text: 'later', style: 'cancel', onPress: onDone },
        { text: 'set them up', onPress: () => { onDone(); router.push(`/creator/tickets?id=${eventId}` as never); } },
      ],
    });
  };

  const handleSave = async () => {
    if (coverInProgress() || pageTemplateBlocked()) return;
    const fields = collectFields({ requireDate: true });
    if (!fields || saving || explicitSaveRef.current) return;
    if (offerType === 'ticketed_event' && !fields.end_time) {
      showError('add an end time', 'paid tickets need to know when the event ends so payouts can be released.');
      return;
    }
    explicitSaveRef.current = true;
    if (pageContext) Keyboard.dismiss();
    setSaving(true);
    try {
      if (editing && id) {
        await autosaveInFlightRef.current?.catch(() => undefined);
        await saveEventFields(id, fields);
        await syncCoords(id);
        await syncOfferType(id);
        await syncTicketCapacity(id);
        hapticSuccess();
        afterSave();
        if (returnToTickets === '1') {
          leaveEditor();
          return;
        }
        await warnIfNothingOnSale(id, () => leaveEditor());
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        // Ticketed creation is a guided draft-first flow. An event must exist
        // before its priced tier can exist, so create the private draft and
        // continue directly to ticket setup instead of publishing a shell.
        const ticketedSetup = offerType === 'ticketed_event';
        const newId = await createOperatorEvent(fields, communityId, !ticketedSetup);
        await syncCoords(newId);
        await syncOfferType(newId);
        await syncTicketCapacity(newId);
        hapticSuccess();
        afterSave();
        if (ticketedSetup) {
          router.replace(`/creator/event-form?id=${newId}` as never);
          router.push(`/creator/tickets?id=${newId}&setup=1` as never);
          return;
        }
        if (communityId) {
          offerAnnounce(newId);
        } else {
          await warnIfNothingOnSale(newId, () => leaveEditor());
        }
      }
    } catch (e) {
      showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      explicitSaveRef.current = false;
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
    ...(offerType === 'ticketed_event'
      ? [{ label: 'a paid ticket on sale', done: ticketSetupState === 'ready' }]
      : []),
  ];

  const autosaveSignature = JSON.stringify([
    title, description, imageUrl, date, time, endDate, endTime, venue, venueAddress,
    category, categories, fromCommunity, pageContext?.kind, ticketPrice, publicName, pinToChat, blocks,
    ...(pageContext ? [offerType, ticketCapacity, coords, externalUrl, afterPurchaseOpen, afterPurchaseMsg] : []),
  ]);
  const latestAutosaveSignature = React.useRef(autosaveSignature); latestAutosaveSignature.current = autosaveSignature;
  const lastSavedRef = React.useRef<string | null>(null);
  const autosaveInFlightRef = React.useRef<Promise<void> | null>(null);
  const explicitSaveRef = React.useRef(false);
  useEffect(() => {
    if (!pageContext || !pageSave.outcome || !pageSave.confirmedInput) return;
    const fields = collectFields({ silent: true });
    const input = pageSave.confirmedInput;
    if (fields && JSON.stringify(fields) === JSON.stringify(input.fields) && offerType === input.offerType
      && (ticketCapacity.trim() ? Number(ticketCapacity) : null) === input.ticketCapacity
      && (coords?.lat ?? null) === input.latitude && (coords?.lng ?? null) === input.longitude) {
      lastSavedRef.current = autosaveSignature;
      setAutosaveState('saved');
    }
    // Read-only recovery of a saved attempt must not schedule that save again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSave.outcome]);
  useEffect(() => {
    if (!isDraft || !id || saving || !seeded || !pageStatusWritable || pagePublicationUncertain || (pageContext && (!pageSettingsSeeded || !pageSave.ready))) return;
    if (lastSavedRef.current === null) {
      lastSavedRef.current = autosaveSignature;
      return;
    }
    if (lastSavedRef.current === autosaveSignature) return;
    const handle = setTimeout(async () => {
      if (explicitSaveRef.current) return;
      const fields = collectFields({ silent: true });
      if (!fields) return;
      const olderAutosave = autosaveInFlightRef.current;
      let didSave = false;
      const autosave = (async () => {
        await olderAutosave?.catch(() => undefined);
        if (explicitSaveRef.current) return;
        await saveEventFields(id, fields);
        didSave = true;
      })();
      autosaveInFlightRef.current = autosave;
      try {
        setAutosaveState('saving');
        await autosave;
        if (!didSave) return;
        lastSavedRef.current = autosaveSignature;
        setAutosaveState(latestAutosaveSignature.current === autosaveSignature ? 'saved' : 'idle');
      } catch {
        // never a blocking alert on a background save; the explicit save
        // button remains the honest path and will surface the real error
        // A matching server receipt remains saved if only local cleanup failed.
        setAutosaveState(lastSavedRef.current === autosaveSignature && latestAutosaveSignature.current === autosaveSignature ? 'saved' : 'problem');
      } finally {
        if (autosaveInFlightRef.current === autosave) autosaveInFlightRef.current = null;
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveSignature, isDraft, id, saving, seeded, pagePublicationUncertain, pageSettingsSeeded, pageSave.ready, pageStatusWritable]);
  const handleSaveDraft = async () => {
    if (coverInProgress() || pageTemplateBlocked()) return;
    const fields = collectFields();
    if (!fields || saving || explicitSaveRef.current) return;
    explicitSaveRef.current = true;
    if (pageContext) Keyboard.dismiss();
    setSaving(true);
    try {
      if (editing && id) {
        await autosaveInFlightRef.current?.catch(() => undefined);
        await saveEventFields(id, fields);
        await syncCoords(id);
      } else {
        const communityId = fromCommunity && community ? community.id : null;
        const newId = await createOperatorEvent(fields, communityId, false);
        await syncCoords(newId);
      }
      hapticSuccess();
      afterSave();
      leaveEditor();
    } catch (e) {
      showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      explicitSaveRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Ticket setup reads the saved event row, not the form's local state. Flush
   * the full event first so a freshly selected end time is guaranteed to be
   * present before a paid tier can be added. This is shared by Community and
   * Organization events because community attribution does not change the
   * event writer.
   */
  const handleOpenTickets = async (setupMode = false) => {
    if (coverInProgress() || pageTemplateBlocked()) return;
    if (!id || saving || explicitSaveRef.current || (pageContext && !pageSave.current?.canManageTickets)) return;
    const fields = collectFields({ requireDate: true });
    if (!fields) return;
    if (!fields.end_time) {
      showError('add an end time', 'paid tickets need to know when the event ends so payouts can be released.');
      return;
    }
    explicitSaveRef.current = true;
    if (pageContext) Keyboard.dismiss();
    setSaving(true);
    try {
      setAutosaveState('saving');
      await runPaidTicketSetupHandoff({
        pendingAutosave: autosaveInFlightRef.current,
        saveEvent: async () => { await saveEventFields(id, fields); },
        syncEventState: async () => {
          await syncCoords(id);
          await syncOfferType(id);
          await syncTicketCapacity(id);
        },
        invalidateTicketEvent: () => queryClient.invalidateQueries({ queryKey: ['ticket-setup-event', id] }),
        navigate: () => router.push(`/creator/tickets?id=${id}${setupMode ? '&setup=1' : ''}` as never),
      });
      lastSavedRef.current = autosaveSignature;
      setAutosaveState('saved');
    } catch (e) {
      setAutosaveState('problem');
      showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
    } finally {
      explicitSaveRef.current = false;
      setSaving(false);
    }
  };

  const handlePublishDraft = async () => {
    if (coverInProgress() || pageTemplateBlocked()) return;
    const fields = collectFields({ requireDate: true });
    if (!fields || !id || saving || explicitSaveRef.current || publicationUncertain.current) return;
    if (pageContext && !pageContext.isPublished) {
      showError('Publish your page first', 'Your event can stay a draft while your page is reviewed. After approval, publish your page, then publish this saved event.');
      return;
    }
    if (offerType === 'ticketed_event' && !fields.end_time) {
      showError('add an end time', 'paid tickets need to know when the event ends so payouts can be released.');
      return;
    }
    explicitSaveRef.current = true;
    if (pageContext) Keyboard.dismiss();
    setSaving(true);
    let publicationDispatched = false;
    let pageEventSaved = false;
    let active = true;
    const operation = pageScope ? {userId: pageScope.userId, isCurrent: () => active && pageScope.isCurrent()} : undefined;
    const assertPublishing = () => { assertPageVisit(); if (operation && !operation.isCurrent()) throw new CreatorPageScopeExpired(); };
    try {
      const publish = async () => {
        if (!pageContext) {
          // Build 42 closes the disconnected create-to-sell gap. A ticketed event
          // cannot publish until it has a real paid tier on sale. The tier read
          // throws on failure, so this remains fail-closed.
          const tiers = await getTiers(id);
          const paidTiers = tiers.filter((tier) => tier.price_cents > 0);
          const paidOnSale = paidTiers.some((tier) => tier.status === 'on_sale');
          if (offerType === 'ticketed_event' && !paidOnSale) {
            setAlertInfo({
              title: paidTiers.length === 0 ? 'add your ticket and price' : 'put your ticket on sale',
              message: paidTiers.length === 0
                ? 'ticketed events need a paid ticket before they can go live.'
                : 'your paid ticket is still a draft. put it on sale, then publish.',
              buttons: [
                { text: 'not now', style: 'cancel' },
                { text: 'set it up', onPress: () => { void handleOpenTickets(true); } },
              ],
            });
            return;
          }
          if (paidTiers.length > 0) {
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
        }
        await autosaveInFlightRef.current?.catch(() => undefined);
        assertPublishing();
        // Page readiness checks the complete saved event and its financial organizer.
        if (pageContext) { await saveEventFields(id, fields); assertPublishing(); pageEventSaved = true; }
        else await updateOperatorEvent(id, fields, 'Live');
        await syncCoords(id);
        assertPublishing();
        if (pageContext && operation) {
          await syncOfferType(id);
          assertPublishing();
          await syncTicketCapacity(id);
          const readiness = await loadCreatorPageEventReadiness(pageContext.pageId, id, operation);
          assertPublishing();
          if (!readiness.publishReady) {
            const guidance = pageEventPublishGuidance[readiness.publishReason!];
            setAlertInfo({ ...guidance, buttons: readiness.publishReason === 'paid_ticket_required' && readiness.canManageTickets
              ? [{ text: 'not now', style: 'cancel' }, { text: 'set it up', onPress: () => { void handleOpenTickets(true); } }]
              : [{ text: 'OK' }] });
            return;
          }
          publicationDispatched = true;
          await publishCreatorPageEvent({ pageId: pageContext.pageId, eventId: id }, operation);
          assertPublishing();
        }
        hapticSuccess();
        afterSave();
        queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
        if (eventCommunityId) {
          offerAnnounce(id);
        } else {
          leaveEditor();
        }
      };
      if (pageContext) await requestWithDeadline(publish(), 25_000);
      else await publish();
    } catch (e) {
      if (pageScope && !pageScope.isCurrent()) return;
      if (publicationDispatched && pageScope?.isCurrent()) setPagePublicationUncertain(true);
      showError(publicationDispatched ? 'Check the saved event' : pageEventSaved ? 'Could not check publication' : pageContext ? 'Check saved status' : 'That did not save', publicationDispatched ? 'We could not confirm publication. Check its saved status before continuing.' : pageEventSaved ? 'Your event was saved. Check its setup and try publishing again.' : pageContext && e instanceof RequestDeadlineError ? 'Your changes have not been confirmed. Check the saved status before continuing.' : friendlyError(e, 'Try again in a moment.'));
    } finally {
      active = false;
      explicitSaveRef.current = false;
      if (!pageScope || pageScope.isCurrent()) setSaving(false);
    }
  };

  const checkPagePublication = async () => {
    if (!id || !pageContext || saving || explicitSaveRef.current || !pageScope?.isCurrent()) return;
    explicitSaveRef.current = true; setSaving(true);
    let active = true;
    const operation = {userId: pageScope.userId, isCurrent: () => active && pageScope.isCurrent()};
    try {
      await requestWithDeadline((async () => {
        const saved = await getPageEventSaveState(pageContext.pageId, id, operation);
        if (!operation.isCurrent()) throw new CreatorPageScopeExpired();
        if (saved.pageId !== pageContext.pageId || saved.eventId !== id) throw new Error('Event unavailable');
        if (saved.status === 'Live') { afterSave(); leaveEditor(); return; }
        if (saved.status !== 'Draft') throw new Error('This event is no longer a draft');
        setPagePublicationUncertain(false);
        showError('Still a private draft', 'The saved event is private. You can try publishing it again.');
      })(), 12_000);
    } catch { if (pageScope.isCurrent()) showError('Could not check the event', 'Publication has not been confirmed. Your saved event is kept. Check its status again.'); }
    finally { active = false; explicitSaveRef.current = false; if (pageScope.isCurrent()) setSaving(false); }
  };

  const handleSaveTemplate = async () => {
    if (coverInProgress() || pageTemplateBlocked()) return;
    const fields = collectFields();
    if (!fields || saving || explicitSaveRef.current || pageContext && (!pageSave.canWrite() || !pageStatus.canWrite() || pagePublicationUncertain)) return;
    explicitSaveRef.current = true;
    setSaving(true);
    if (pageContext) Keyboard.dismiss();
    try {
      if (pageContext && pageScope && id) {
        const templateResult = await pageTemplate.begin(async operation => {
          await autosaveInFlightRef.current?.catch(() => undefined);
          assertPageVisit();
          if (!operation.isCurrent()) throw new CreatorPageScopeExpired();
          const saved = await saveEventFields(id, fields, true);
          if (!operation.isCurrent()) throw new CreatorPageScopeExpired();
          if (!saved) throw new Error('Check the complete event save before saving a template.');
          // The short library label never truncates the saved event title.
          let name = '';
          for (const character of fields.title) {
            if (name.length + character.length > 80) break;
            name += character;
          }
          return {name: name.trim(), updatedAt: saved.updatedAt};
        });
        assertPageVisit();
        if (templateResult.state !== 'saved') return;
      } else {
        const communityId = editing ? eventCommunityId : (fromCommunity && community ? community.id : null);
        await existingSaveEventTemplate(fields.title, fields, communityId);
      }
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['event-templates'] });
      setAlertInfo({ title: 'saved as a template', message: pageContext
        ? 'Your saved event is now a template. It keeps its page permissions. Saving a template does not publish your event.'
        : 'it lives on your events tab. put it on anytime.' });
    } catch (e) {
      if (!pageScope || pageScope.isCurrent()) showError(pageContext ? 'Check saved status' : 'That did not save', pageContext && e instanceof RequestDeadlineError ? 'The template has not been confirmed. Check its saved status before continuing.' : friendlyError(e, pageContext ? 'Check its saved status before trying again.' : 'Try again in a moment.'));
    } finally {
      explicitSaveRef.current = false;
      if (!pageScope || pageScope.isCurrent()) setSaving(false);
    }
  };

  const recoverPageTemplate = async (action: 'check' | 'retry') => {
    if (!pageScope?.isCurrent() || saving || explicitSaveRef.current || coverInProgress()) return;
    explicitSaveRef.current = true; setSaving(true);
    try {
      const result = await (action === 'check' ? pageTemplate.check() : pageTemplate.retry());
      if (pageScope.isCurrent() && result?.state === 'saved') {
        queryClient.invalidateQueries({ queryKey: ['event-templates'] });
      }
    } finally {
      explicitSaveRef.current = false;
      if (pageScope.isCurrent()) setSaving(false);
    }
  };

  const reviewPageTemplate = async () => {
    if (!pageContext || !pageScope?.isCurrent() || saving || explicitSaveRef.current || coverInProgress()) return;
    explicitSaveRef.current = true; setSaving(true);
    try {
      const result = await pageTemplate.review();
      if (!pageScope.isCurrent()) return;
      if (result?.state === 'retired') {
        afterSave();
        router.dismissTo((pageContext.entry === 'team' ? `/creator/page-events?id=${pageContext.pageId}` : `/creator/page?id=${pageContext.pageId}`) as never);
      } else if (result?.state === 'saved') queryClient.invalidateQueries({queryKey: ['event-templates']});
    } finally {
      explicitSaveRef.current = false;
      if (pageScope.isCurrent()) setSaving(false);
    }
  };

  const reviewPageRefunds = async () => {
    if (!pageScope?.isCurrent() || !id || saving || explicitSaveRef.current) return;
    explicitSaveRef.current = true; setSaving(true);
    let active = true;
    const operation = {userId: pageScope.userId, isCurrent: () => active && pageScope.isCurrent()};
    try {
      await requestWithDeadline((async () => {
        await assertPageEventStatusAccount(operation);
        const access = await getRefundAccess(id, operation);
        await assertPageEventStatusAccount(operation);
        if (!access.canRefund) throw new Error('The event’s financial organizer needs to review the remaining ticket refunds.');
        router.push(`/creator/attendees?id=${id}` as never);
      })(), 12_000);
    } catch (e) { if (pageScope.isCurrent()) showError('Refunds need review', friendlyError(e, 'Could not confirm refund access. Try checking again.')); }
    finally { active = false; explicitSaveRef.current = false; if (pageScope.isCurrent()) setSaving(false); }
  };

  const runPageStatus = async (status: PageEventStatus, fields: OperatorEventFields) => {
    if (!pageContext || !pageScope || !id || saving || explicitSaveRef.current || (!pageStatus.canWrite() || pageTemplateBlocked())) return;
    explicitSaveRef.current = true; setSaving(true); Keyboard.dismiss();
    let cancelSummary: CancelRefundSummary | null = null;
    try {
      await autosaveInFlightRef.current?.catch(() => undefined);
      const saved = await saveEventFields(id, fields);
      if (!saved) throw new Error('Check the complete event save before continuing.');
      await pageStatus.begin({status, expectedUpdatedAt: saved.updatedAt}, async operation => {
        if (status !== 'Cancelled') return;
        const readiness = await loadCreatorPageEventReadiness(pageContext.pageId, id, operation);
        if (!operation.isCurrent()) throw new CreatorPageScopeExpired();
        if (!readiness.cancellationRequiresRefunds) return;
        const checkFinancialOwner = async () => {
          await assertPageEventStatusAccount(operation);
          await loadCreatorPageEventReadiness(pageContext.pageId, id, operation);
          const access = await getRefundAccess(id, operation);
          await assertPageEventStatusAccount(operation);
          // The existing bulk helper is the owner's cancellation workflow.
          // Granted delegates use the existing per-order reason/review screen.
          if (!access.isOwner) throw new Error('Review the ticket refunds with the financial organizer before finishing cancellation.');
        };
        cancelSummary = await refundLiveOrdersOnCancel(id, {beforeEach: checkFinancialOwner, scope: operation});
        const afterRefunds = await loadCreatorPageEventReadiness(pageContext.pageId, id, operation);
        if (cancelSummary.failedCount === 0 && afterRefunds.cancellationRequiresRefunds) throw new Error('Ticket refunds still need confirmation. Check them before finishing cancellation.');
      });
      assertPageVisit(); hapticLight(); afterSave();
      // Preserve the owner's existing partial-refund follow-up instead of
      // claiming all money has settled from the event-status receipt.
      const summary = cancelSummary as CancelRefundSummary | null;
      if (summary && summary.failedCount > 0) showError('some refunds need a follow-up', `${summary.refundedCount} of ${summary.refundedCount + summary.failedCount} buyers were refunded. Open who's coming to review the rest.`);
      else leaveEditor();
    } catch (e) { if (pageScope.isCurrent()) showError('Check this event action', e instanceof RequestDeadlineError ? 'This action took longer than expected. Check its saved status before continuing.' : friendlyError(e, 'Check its saved status before trying again.')); }
    finally { explicitSaveRef.current = false; if (pageScope.isCurrent()) setSaving(false); }
  };

  const handleStatus = (status: 'Completed' | 'Cancelled') => {
    const fields = collectFields();
    if (!fields || !id || saving || explicitSaveRef.current || !pageStatusWritable) return;
    // LIZ COPY, except the Cancelled disclosure line: copy to the taste gate (TK-08)
    setAlertInfo({
      title: status === 'Cancelled' ? 'cancel this event?' : 'mark it completed?',
      message:
        status === 'Cancelled'
          ? "it comes off the scene everywhere. groups that formed around it keep their plans and decide for themselves. anyone who paid for a ticket gets refunded in full."
          : 'it comes off the scene and into your past events.',
      buttons: [
        { text: 'keep it live', style: 'cancel' },
        {
          // muted confirm, never red (C13); the web console matches
          text: status === 'Cancelled' ? 'cancel it' : 'complete it',
          onPress: async () => {
            if (pageContext) { await runPageStatus(status, fields); return; }
            try {
              let cancelSummary: CancelRefundSummary | null = null;
              if (status === 'Cancelled') cancelSummary = await refundLiveOrdersOnCancel(id);
              await updateOperatorEvent(id, fields, status);
              if (cancelSummary && cancelSummary.failedCount > 0) {
                hapticLight();
                afterSave();
                // copy to the taste gate (TK-08)
                showError(
                  'some refunds need a follow-up',
                  `${cancelSummary.refundedCount} of ${cancelSummary.refundedCount + cancelSummary.failedCount} buyers were refunded. the rest didn't go through -- open who's coming to retry them.`,
                );
              } else {
                hapticLight();
                afterSave();
                leaveEditor();
              }
            } catch (e) {
              showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
            }
          },
        },
      ],
    });
  };

  const handlePoster = async () => {
    if(posterLock.current||privateCover.busy||bodyMediaWork.current||!!pageContext&&(explicitSaveRef.current||pageTemplateBlocked()))return;
    posterLock.current=true;
    setUploading(true);
    try {
      const url = await pickAndUploadEventImage(pageMediaGuard,pageContext?privateCover.upload:undefined);
      pageMediaGuard?.assertCurrent();
      if (url) setImageUrl(url);
    } catch (e) {
      if(!pageScope||pageScope.isCurrent())showError('That photo did not upload', friendlyError(e, 'Try again in a moment.'));
    } finally {
      posterLock.current=false;
      if(!pageScope||pageScope.isCurrent())setUploading(false);
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
      showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
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
    if (coverInProgress() || pageTemplateBlocked()) return;
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
          await saveEventFields(id, fields);
          await syncCoords(id);
          setAutosaveState('saved');
        } catch {
          setAutosaveState('problem');
          showError('Preview is not ready', 'We couldn’t confirm your latest save. Your edits are still here. Check the save status, then try preview again.');
          return;
        }
      }
      router.push(`/event/${id}?preview=guest${pageContext ? `&pageId=${pageContext.pageId}${pageContext.entry === 'team' ? '&team=1' : ''}` : ''}` as never);
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
      showError(pageContext ? 'Check saved status' : 'That did not save', friendlyError(e, 'Try again in a moment.'));
    }
    } finally {
      setPreviewing(false);
    }
  };

  const loadingEdit = (editing || !!duplicateFrom) && !seeded;
  const currentSaveConfirmed = !!pageContext && !!pageSave.outcome && lastSavedRef.current === autosaveSignature;

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

  if (!pageContext && access && !access.hasEventHostGrant && !canManageEvents(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  const saveRecovery = (pageContext && (!pageSave.loaded || (!pageSave.busy && pageSave.recoveryRequired) || pageSave.error || pageSave.conflict) && <View style={[styles.sectionCard, styles.recoveryCard]}>
              <GoldSurfaceFill />
              <Text accessibilityRole="alert" style={[styles.fieldHint, styles.recoveryCopy]}>{pageSave.conflict ? 'This event changed elsewhere. Return to the page and reopen it to review the latest version.' : pageSave.error ?? (pageSave.retryReady ? 'No confirmation yet. Retry the same changes.' : pageSave.recoveryRequired ? 'Check your original event save before continuing.' : 'Checking saved event settings…')}</Text>
              {!pageSave.conflict && <TouchableOpacity accessibilityRole="button" accessibilityLabel={pageSave.retryReady ? 'Retry original event save' : 'Check complete event save'} disabled={pageSave.busy} style={styles.recoveryAction} onPress={() => void (pageSave.retryReady ? pageSave.retry() : pageSave.loaded || pageSave.recoveryRequired ? pageSave.check() : pageSave.refresh())}>
                <CreatorActionFill />
                <Text numberOfLines={1} style={styles.recoveryActionText}>{pageSave.busy ? 'Checking…' : pageSave.retryReady ? 'Retry save' : 'Check status'}</Text>
              </TouchableOpacity>}
              {pageSave.retryReady && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check complete event save" disabled={pageSave.busy} style={styles.recoveryRetry} onPress={() => void pageSave.check()}><Text numberOfLines={1} style={[styles.quietLink, styles.recoveryCopy]}>Check status</Text></TouchableOpacity>}
            </View>);

  const statusConfirmed = !!(pageStatus.outcome || pageStatus.alreadyClosed);
  const finishingCancellation = pageStatus.pending?.input.status === 'Cancelled';
  const recordedStatusCopy = pageStatus.outcome ? `Your event is ${pageStatus.outcome.status.toLowerCase()}. Your page has the latest status.` : 'This event action is recorded. Your page has the latest status.';
  const statusNeedsCheck = !pageStatus.conflict && (!statusConfirmed || !!pageStatus.pending || !!pageStatus.error);
  const statusRecovery = pageContext && (!pageStatus.loaded || pageStatus.error || pageStatus.conflict || (!pageStatus.busy && (pageStatus.pending || statusConfirmed))) && (
    <View style={[styles.sectionCard, styles.recoveryCard]}>
      <GoldSurfaceFill />
      <Text accessibilityRole="alert" style={[styles.fieldHint, styles.recoveryCopy]}>{pageStatus.conflict
        ? 'This event changed. Reopen it from your page to review the latest details.'
        : pageStatus.error ?? (pageStatus.refundsNeedReview
          ? statusConfirmed ? 'The event is cancelled. Some ticket refunds still need review.' : 'Ticket refunds still need review before this action can finish.'
          : statusConfirmed ? recordedStatusCopy
          : pageStatus.retryReady ? `No confirmation yet. You can ${finishingCancellation ? 'finish cancelling this event' : 'mark this event completed'} or check again.`
          : pageStatus.pending ? 'Check this event action before continuing.' : 'Checking event actions…')}</Text>
      {statusNeedsCheck && <TouchableOpacity accessibilityRole="button" accessibilityLabel={pageStatus.retryReady ? 'Finish original event action' : 'Check event action'} disabled={saving || pageStatus.busy} style={styles.recoveryAction} onPress={() => void (pageStatus.retryReady ? pageStatus.retry() : pageStatus.check())}>
        <CreatorActionFill />
        <Text numberOfLines={1} style={styles.recoveryActionText}>{pageStatus.busy ? 'Checking…' : pageStatus.retryReady ? finishingCancellation ? 'Finish cancellation' : 'Mark completed' : 'Check status'}</Text>
      </TouchableOpacity>}
      {pageStatus.retryReady && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check event action" disabled={saving || pageStatus.busy} style={styles.recoveryRetry} onPress={() => void pageStatus.check()}><Text style={[styles.quietLink, styles.recoveryCopy]}>Check status</Text></TouchableOpacity>}
      {pageStatus.refundsNeedReview && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Review remaining ticket refunds" disabled={saving || pageStatus.busy} style={styles.recoveryRetry} onPress={() => void reviewPageRefunds()}><Text style={[styles.quietLink, styles.recoveryCopy]}>Review refunds</Text></TouchableOpacity>}
      {(statusConfirmed || pageStatus.conflict) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Return to the page" disabled={saving || pageStatus.busy} style={statusNeedsCheck ? styles.recoveryRetry : styles.recoveryAction} onPress={() => { afterSave(); leaveEditor(); }}>
        {!statusNeedsCheck && <CreatorActionFill />}
        <Text numberOfLines={1} style={statusNeedsCheck ? [styles.quietLink, styles.recoveryCopy] : styles.recoveryActionText}>Back to page</Text>
      </TouchableOpacity>}
    </View>
  );

  const templateNeedsCheck = !pageTemplate.loaded || pageTemplate.recoveryRequired || !!pageTemplate.error;
  const templateRecovery = pageContext && (!pageTemplate.loaded || (!pageTemplate.busy && pageTemplate.recoveryRequired) || pageTemplate.error || pageTemplate.saved || pageTemplate.retired) && (
    <View style={[styles.sectionCard, styles.recoveryCard]}>
      <GoldSurfaceFill />
      <Text accessibilityRole="alert" style={[styles.fieldHint, styles.recoveryCopy]}>{pageTemplate.stale || pageTemplate.retired
        ? pageTemplate.error ?? 'This event changed before the template was saved. Go back to its page and reopen the event to review the latest version.'
        : pageTemplate.saved
        ? pageTemplate.recoveryRequired ? 'Your template is saved. Check once more to finish recovery on this device.' : 'Your template is saved. Your event’s publication status has not changed.'
        : pageTemplate.error ?? (pageTemplate.retryReady ? 'No confirmation yet. Retry the same template.' : pageTemplate.recoveryRequired ? 'Check the original template attempt before continuing.' : 'Checking your template attempt…')}</Text>
      {templateNeedsCheck && <TouchableOpacity accessibilityRole="button" accessibilityLabel={pageTemplate.retryReady ? 'Retry original template' : 'Check original template'} disabled={saving || pageTemplate.busy || coverInProgress()} style={styles.recoveryAction} onPress={() => void recoverPageTemplate(pageTemplate.retryReady ? 'retry' : 'check')}>
        <CreatorActionFill /><Text numberOfLines={1} style={styles.recoveryActionText}>{pageTemplate.busy ? 'Checking…' : pageTemplate.retryReady ? 'Retry template' : 'Check template'}</Text>
      </TouchableOpacity>}
      {pageTemplate.retryReady && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check original template" disabled={saving || pageTemplate.busy || coverInProgress()} style={styles.recoveryRetry} onPress={() => void recoverPageTemplate('check')}><Text style={[styles.quietLink, styles.recoveryCopy]}>Check status</Text></TouchableOpacity>}
      {(pageTemplate.stale || pageTemplate.retired) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Return to page and review the latest event" disabled={saving || pageTemplate.busy || coverInProgress()} style={styles.recoveryRetry} onPress={() => void reviewPageTemplate()}><Text style={[styles.quietLink, styles.recoveryCopy]}>Back to page</Text></TouchableOpacity>}
      {pageTemplate.saved && !templateNeedsCheck && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Return to the page after saving template" disabled={saving || pageTemplate.busy || coverInProgress()} style={styles.recoveryAction} onPress={() => { afterSave(); leaveEditor(); }}><CreatorActionFill /><Text numberOfLines={1} style={styles.recoveryActionText}>Back to page</Text></TouchableOpacity>}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBack} onPress={() => leaveEditor()} hitSlop={8}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          {!loadingEdit && (
            /* §3.0 phone: persistent "preview as guest" (LIZ COPY, taste gate) */
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview as guest" style={styles.headerPreview} onPress={handlePreview} disabled={saving || previewing || coverInProgress() || pageTemplateBlocked()} hitSlop={8}>
              <Text style={styles.previewAction}>preview as guest</Text>
            </TouchableOpacity>
          )}
          <ProfileButton compact />
        </View>

        {loadingEdit ? (
          pageContext && (pageSave.error || pageSave.conflict) ? (
            <ScrollView contentContainerStyle={styles.content}>
              <Text accessibilityRole="header" style={styles.title}>Your event couldn’t load</Text>
              {saveRecovery}
            </ScrollView>
          ) : <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Loading event" size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <ScrollView
            ref={editorScroll}
            pointerEvents={pageContext && saving ? 'none' : 'auto'}
            contentContainerStyle={styles.content}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            onScrollBeginDrag={Keyboard.dismiss}
          >
            <Text style={styles.title}>{editing ? 'edit your event' : duplicateFrom ? 'put it on again' : 'put on an event'}</Text>
            {!editing && !!duplicateFrom && (
              /* LIZ COPY */
              <Text style={styles.statusLine}>same event, fresh date. pick the new one.</Text>
            )}
            {autosaveState !== 'idle' && (
              /* law 19: the organizer can SEE that their work is safe. Shown for
                 draft autosave AND for a preview-triggered save on a new create,
                 so a row is never written on their behalf silently */
              <Text style={[styles.savedLine, autosaveState === 'problem' && !currentSaveConfirmed && styles.savedLineProblem]}>
                {/* copy to the taste gate */}
                {autosaveState === 'saving'
                  ? 'saving…'
                  : autosaveState === 'saved' || currentSaveConfirmed
                    ? 'saved just now'
                    : 'not saved yet. your work is still here.'}
              </Text>
            )}

            {editing && eventStatus !== 'Live' && (
              /* LIZ COPY */
              <Text style={styles.statusLine}>
                {pagePublicationUncertain ? 'Your event is saved. Check whether it’s live.' : eventStatus === 'Draft'
                  ? pageContext ? 'a private draft. publish when it’s ready.' : 'a draft. only you see it until you publish.'
                  : `this event is ${eventStatus.toLowerCase()}.`}
              </Text>
            )}

            {saveRecovery}
            {statusRecovery}
            {templateRecovery}
            {pageContext && pagePublicationUncertain && <View style={[styles.sectionCard, styles.recoveryCard]}>
              <GoldSurfaceFill />
              <Text accessibilityRole="alert" style={[styles.fieldHint, styles.recoveryCopy]}>Publication has not been confirmed. Check the saved event before continuing.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check saved event status" onPress={() => void checkPagePublication()} disabled={saving} style={styles.recoveryAction}>
                <CreatorActionFill /><Text numberOfLines={1} style={styles.recoveryActionText}>{saving ? 'Checking…' : 'Check status'}</Text>
              </TouchableOpacity>
            </View>}

            {pageContext && pageSettingsSeeded && !pageSave.current?.canManageTickets &&
              <Text style={styles.permissionNote}>Event format, capacity and ticket tools need separate access.</Text>}
            {editing && (!pageContext || pageSave.current?.canManageTickets) && offerType === 'ticketed_event' && (ticketSetupState === 'missing' || ticketSetupState === 'draft') && (
              // Audit finding (75-threshold spec item 2): durable version of
              // warnIfNothingOnSale's one-time popup -- stays visible on
              // every visit to this event until tickets are actually on sale.
              <TouchableOpacity
                style={styles.ticketNudge}
                onPress={() => { void handleOpenTickets(); }}
                disabled={saving || coverInProgress()}
                activeOpacity={0.85}
              >
                <View style={styles.ticketNudgeBody}>
                  {/* copy to the taste gate */}
                  <Text style={styles.ticketNudgeTitle}>
                    {ticketSetupState === 'missing' ? 'add your ticket and price' : 'your tickets are still drafts'}
                  </Text>
                  <Text style={styles.ticketNudgeMeta}>
                    {eventStatus === 'Live'
                      ? 'this event is up, but nobody can buy a ticket yet. set it up →'
                      : 'finish ticket setup before you publish. set it up →'}
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.terracotta} strokeWidth={2.5} />
              </TouchableOpacity>
            )}

            {/* §3 canvas: this is not a form of grey boxes, it is a PAGE being
                built. The top half is the page itself, media-led (doc 80: the
                cover is the one warm-dark surface, so it reads as the face of a
                page, not a field); the logistics follow as quieter cards. */}

            {/* §3.1 cover: the page's face, a real 4:5 warm-dark drop-zone */}
            {imageUrl ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose event cover" onPress={handlePoster} disabled={uploading || bodyMediaBusy || privateCover.busy || privateCover.loading || !!pageContext && (!pageSave.ready || pageTemplateBlocked())} activeOpacity={0.9}>
                <EventMediaImage eventId={id ?? ''} reference={imageUrl} style={styles.cover} contentFit="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.coverAdd} accessibilityRole="button" accessibilityLabel="Choose event cover" onPress={handlePoster} disabled={uploading || bodyMediaBusy || privateCover.busy || privateCover.loading || !!pageContext && (!pageSave.ready || pageTemplateBlocked())} activeOpacity={0.9}>
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

            {pageContext && (privateCover.busy || privateCover.error || privateCover.attempts.length>0) && <View>
              {privateCover.busy && <>
                <Text style={styles.fieldHint} accessibilityLiveRegion="polite">{privateCover.progress?.phase==='uploading'?'Uploading your cover…':'Checking your cover…'}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel cover upload" style={styles.quietLinkWrap} onPress={privateCover.cancel}><Text style={styles.quietLink} numberOfLines={1}>Cancel upload</Text></TouchableOpacity>
              </>}
              {!!privateCover.error && <Text style={styles.fieldHint} accessibilityRole="alert">{privateCover.error}</Text>}
              {!privateCover.busy && privateCover.attempts.map((attempt,index)=><View key={attempt.mediaId}>
                <Text style={styles.fieldHint}>{privateCover.attempts.length>1?`Saved cover upload ${index+1}`:'Saved cover upload'}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry saved cover upload ${index+1}`} disabled={uploading || (!pageSave.ready || pageTemplateBlocked())} style={styles.quietLinkWrap} onPress={()=>void privateCover.retry(attempt).catch(()=>undefined)}><Text style={styles.quietLink} numberOfLines={1}>Retry upload</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Discard saved cover upload ${index+1}`} disabled={uploading || (!pageSave.ready || pageTemplateBlocked())} style={styles.quietLinkWrap} onPress={()=>void privateCover.discard(attempt).catch(()=>undefined)}><Text style={styles.quietLink} numberOfLines={1}>Discard upload</Text></TouchableOpacity>
              </View>)}
              {!privateCover.busy && !!privateCover.error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check saved cover uploads" disabled={uploading || privateCover.loading} style={styles.quietLinkWrap} onPress={()=>void privateCover.refresh()}><Text style={styles.quietLink} numberOfLines={1}>Check uploads</Text></TouchableOpacity>}
            </View>}

            {/* §3.2 title: a name, not a form field (shared editorial field) */}
            <EditorialTitleField appearance={appearance}
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
            <DescriptionBlocksEditor appearance={appearance}
              mediaGuard={pageMediaGuard}
              pageId={pageContext?.pageId}
              pageScope={pageScope}
              savedBlocks={pageSave.current?.fields.description_blocks??undefined}
              beginMediaWork={pageContext?beginBodyMediaWork:undefined}
              mediaBusy={!!pageContext&&(uploading||bodyMediaBusy||privateCover.busy)}
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
              <CollapsibleCalendar appearance={appearance}
                selected={dayIsPast ? null : parsedDay}
                onSelect={(d) => setDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                /* LIZ COPY */
                placeholder={dayIsPast ? `it was ${formatEventDateLA(date.trim())}. pick a new day` : 'pick a day'}
              />
            </View>

            <View style={styles.pickerBlock}>
              <TimePicker appearance={appearance}
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove start time" style={styles.clearTimeAction} onPress={() => { hapticLight(); setTime(''); }}>
                  {/* LIZ COPY: a set time stays optional, so it must be removable */}
                  <Text style={styles.clearTimeLink}>no set time</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.fieldLabel}>ends{offerType === 'ticketed_event' ? ' · required' : ''}</Text>
            {/* copy to the taste gate (§3.3): optional for free events and
                required for paid events because payout release depends on it.
                a blank end day means the same day as the start. */}
            <Text style={styles.fieldHint}>
              {offerType === 'ticketed_event'
                ? 'required for paid tickets and payout release.'
                : 'optional. sets when it wraps.'}
            </Text>
            <View style={styles.pickerBlock}>
              <CollapsibleCalendar appearance={appearance}
                selected={endDayIsPast ? null : parsedEndDay}
                onSelect={(d) => setEndDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                /* LIZ COPY: a blank end day is the same day as the start */
                placeholder={endDayIsPast ? `it was ${formatEventDateLA(endDate.trim())}. pick a new day` : 'same day, or pick another'}
              />
            </View>
            <View style={styles.pickerBlock}>
              <TimePicker appearance={appearance}
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove end time" style={styles.clearTimeAction} onPress={() => { hapticLight(); setEndTime(''); setEndDate(''); }}>
                  {/* LIZ COPY: free events may remove it; paid-event save will explain the requirement */}
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
            <CreatorEventCategoryFields categories={categories} community={(pageContext ? pageContext.kind==='community' : fromCommunity)} ready={!saving && (!pageContext || pageSave.ready && pageStatusWritable && !pageTemplateBlocked())} onCategories={setCategories} />

            {/* C-18: the four decided-sellable offer types (lib/offerTypes.ts
                isOfferTypeSellableToday). class_pack and subscription render
                disabled with a "soon" tag and are never selectable -- that
                stays an open founder decision, not guessed at here. */}
            <Text style={styles.fieldLabel}>offer type</Text>
            <Text style={styles.fieldHint}>choose how people join, from a free gathering to a paid event or course.</Text>
            <View style={styles.chipWrap}>
              {OFFER_TYPE_OPTIONS.map((o) => {
                const sellable = isOfferTypeSellableToday(o.value);
                const on = offerType === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.chip, on && styles.chipOn, !sellable && styles.chipDisabled]}
                    onPress={() => { if (!sellable || (pageContext && (!pageSettingsSeeded || !pageSave.ready || !pageSave.current?.canManageTickets))) return; hapticLight(); setOfferType(o.value); }}
                    disabled={!sellable || !!pageContext && (!pageSettingsSeeded || !pageSave.ready || !pageSave.current?.canManageTickets)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !sellable || !!pageContext && (!pageSettingsSeeded || !pageSave.ready || !pageSave.current?.canManageTickets), selected: on }}
                    accessibilityLabel={sellable ? o.label : `${o.label}, coming soon`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn, !sellable && styles.chipTextDisabled]}>
                      {o.label}{!sellable ? ' · soon' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* C-21: the RSVP cap. Always renders -- real client-side state
                either way, same call as the offer-type picker above -- the
                write RPC's own probe (not shown here) gates the save, not
                the field's visibility. Blank = no limit. */}
            {/* LIZ COPY (proposed, taste gate) */}
            <Text style={styles.fieldLabel}>how many can come</Text>
            <Text style={styles.fieldHint}>leave it blank for no limit. once it&apos;s full, rsvps stop -- nobody gets waitlisted.</Text>
            <TextInput
              style={styles.input}
              value={ticketCapacity}
              editable={!pageContext || pageSettingsSeeded && pageSave.ready && !!pageSave.current?.canManageTickets}
              accessibilityLabel="Event capacity"
              onChangeText={(v) => setTicketCapacity(v.replace(/[^0-9]/g, '').slice(0, 5))}
              keyboardType="number-pad"
              /* copy to the taste gate */
              placeholder="no limit"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* the tickets-link field is GONE per the 7-20 ruling: no
                external ticket links at launch, ticketing runs through
                washedup (doc 61 §1.2). The externalUrl state stays as a
                silent pass-through so existing events' stored links
                survive an edit-save untouched. */}

            {/* the legacy free-text "ticket price" input is GONE (audit
                finding 8): it wrote explore_events.ticket_price, which no
                buyer flow reads, so organizers typed a price here and
                believed tickets were set up while the real tiers stayed
                draft. Real prices live on the tickets screen. The state
                stays as a silent pass-through so existing listings' stored
                values survive a save untouched, exactly like externalUrl. */}

            {/* doc 111: the "after they buy" message; renders only once the
                SQL-96 column exists (join-gate pattern, self-flips on apply) */}
            {afterPurchaseOpen && (
              <>
                {/* LIZ COPY (proposed, taste gate) */}
                <Text style={styles.fieldLabel}>{offerType === 'free_event' ? 'after they join' : 'after they buy'}</Text>
                <Text style={styles.fieldHint}>{offerType === 'free_event' ? 'help people arrive ready with parking, arrival time, or what to bring.' : 'lands on their confirmation and stays on their tickets. things like parking, arrival time, what to wear.'}</Text>
                <TextInput
                  style={[styles.input, styles.inputTall]}
                  value={afterPurchaseMsg}
                  accessibilityLabel="Event confirmation message"
                  maxLength={2500}
                  onChangeText={setAfterPurchaseMsg}
                  placeholder="what should they know once they're in?"
                  placeholderTextColor={Colors.inkSoft}
                  multiline
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>public listing name</Text>
            <Text style={styles.fieldHint}>a brand or venue name to front the listing. leave empty to show yours.</Text>
            <TextInput style={styles.input} value={publicName} onChangeText={setPublicName} maxLength={80} placeholder="a brand or venue name" placeholderTextColor={Colors.inkSoft} inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID} />
            </View>

            <Text style={styles.sectionHeader}>who puts it on</Text>
            <View style={styles.sectionCard}>
            {!editing && !community && (
              <>
                <Text style={styles.fieldLabel}>whose event is this</Text>
                <View style={styles.chipWrap}>
                  <View style={[styles.chip, styles.chipOn]}>
                    <Text style={[styles.chipText, styles.chipTextOn]}>just you</Text>
                  </View>
                </View>
              </>
            )}
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
                {pageContext ? `From ${String(pageContext.name)}. This event stays with this page.` : eventCommunityId ? 'a community event, set at posting.' : 'a standalone event, set at posting.'}
              </Text>
            )}

            {((!editing && fromCommunity && !!community) || (editing && !!eventCommunityId)) && (
              <>
                <Text style={styles.fieldLabel}>pin it in your chat</Text>
                {/* LIZ COPY */}
                <Text style={styles.fieldHint}>your soonest upcoming event sits at the top of your community chat.</Text>
                <View style={styles.chipWrap}>
                  <TouchableOpacity
                    accessibilityRole="button" accessibilityLabel="Pin event in chat" accessibilityState={{selected:pinToChat}}
                    style={[styles.chip, pinToChat && styles.chipOn]}
                    onPress={() => { hapticLight(); setPinToChat(true); }}
                  >
                    <Text style={[styles.chipText, pinToChat && styles.chipTextOn]}>pin it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button" accessibilityLabel="Keep event off chat" accessibilityState={{selected:!pinToChat}}
                    style={[styles.chip, !pinToChat && styles.chipOn]}
                    onPress={() => { hapticLight(); setPinToChat(false); }}
                  >
                    <Text style={[styles.chipText, !pinToChat && styles.chipTextOn]}>keep it off the chat</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {pageContext && <TouchableOpacity style={styles.linkRow} accessibilityRole="button" accessibilityLabel="Page and team" onPress={() => { if (pageScope?.isCurrent()) router.push(`/creator/page-team?id=${pageContext.pageId}` as never); }}>
              <View style={styles.linkRowText}><Text style={styles.linkRowTitle}>Page & team</Text><Text style={styles.linkRowHint}>Permissions apply only to {pageContext.name}.</Text></View>
              <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
            </TouchableOpacity>}
            {!pageContext && CO_CREATOR_INVITES_ENABLED && ((!editing && fromCommunity && !!community) || (editing && !!eventCommunityId)) && (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={() => router.push('/creator/co-creators')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Co-creators"
                accessibilityHint="Invite someone to help run this community."
              >
                <View style={styles.linkRowText}>
                  <Text style={styles.linkRowTitle}>Co-creators</Text>
                  <Text style={styles.linkRowHint}>invite someone to help run this community, not just this event.</Text>
                </View>
                <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
              </TouchableOpacity>
            )}

            {editing && eventCommunityId && eventStatus === 'Live' && eventTopicId && (
              <>
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => router.push(`/community-topic/${eventTopicId}`)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="The room"
                  accessibilityHint="Set the welcome message and coordinate with the people going."
                >
                  <View style={styles.linkRowText}>
                    <Text style={styles.linkRowTitle}>The room</Text>
                    <Text style={styles.linkRowHint}>set the welcome message, coordinate with everyone going.</Text>
                  </View>
                  <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => router.push(`/event-album/${eventTopicId}`)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Photos"
                  accessibilityHint="See and add photos from this event's room."
                >
                  <View style={styles.linkRowText}>
                    <Text style={styles.linkRowTitle}>Photos</Text>
                    <Text style={styles.linkRowHint}>the shared album for this event's room.</Text>
                  </View>
                  <ChevronRight size={20} color={Colors.terracotta} strokeWidth={2.5} />
                </TouchableOpacity>
              </>
            )}
            </View>


            {pageContext && isDraft && !pageContext.isPublished && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewTitle}>Your page is still private</Text>
                <Text style={styles.reviewItem}>Keep preparing this event. After your page is approved, publish it from Creator space before publishing this event into Scene.</Text>
              </View>
            )}
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
              accessibilityRole="button" accessibilityLabel={saving ? 'Saving event' : undefined}
              style={[styles.saveBtn, saving && styles.saveBtnBusy]}
              activeOpacity={0.86}
              onPress={returnToTickets === '1' ? handleSave : pageContext && isDraft && !pageContext.isPublished ? handleSaveDraft : isDraft ? handlePublishDraft : handleSave}
              disabled={saving || coverInProgress() || !pageStatusWritable || pagePublicationUncertain || !!pageContext && (!pageSettingsSeeded || !pageSave.ready)}
            >
              <CreatorActionFill />
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>
                  {returnToTickets === '1' ? 'Save & return' : pageContext && isDraft && !pageContext.isPublished ? 'Save private draft' : isDraft ? (pageContext ? 'Publish into Scene' : 'publish it') : editing ? 'save' : 'put it up'}
                </Text>
              )}
            </TouchableOpacity>

            {(!editing || isDraft) && (
              <TouchableOpacity accessibilityRole="button" onPress={handleSaveDraft} disabled={saving || coverInProgress() || !pageStatusWritable || !!pageContext && (!pageSave.ready || pageTemplateBlocked())} style={styles.quietLinkWrap} hitSlop={8}>
                {/* LIZ COPY */}
                <Text style={styles.quietLink}>{isDraft ? 'keep it a draft' : 'save it as a draft'}</Text>
              </TouchableOpacity>
            )}
            {pageContext && <Text style={styles.fieldHint}>{pagePublicationUncertain
              ? 'Check publication before saving a template.' : isDraft
              ? 'Saving a template also saves this draft. Your event stays private until you publish it.'
              : 'Saving a template also saves your changes to this event. If it is live, people will see those changes.'}</Text>}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save event as template" onPress={handleSaveTemplate} disabled={saving || coverInProgress() || pageTemplateBlocked() || !!pageContext && (!pageSave.ready || !pageStatusWritable || pagePublicationUncertain)} style={styles.quietLinkWrap} hitSlop={8}>
              {/* LIZ COPY */}
              <Text style={styles.quietLink}>save it as a template</Text>
            </TouchableOpacity>

            {editing && eventStatus === 'Live' && (
              <View style={styles.statusRow}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mark event completed" style={styles.statusAction} onPress={() => handleStatus('Completed')} disabled={saving || !pageStatusWritable} hitSlop={6}>
                  <Text style={styles.statusLink}>mark completed</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel event" style={styles.statusAction} onPress={() => handleStatus('Cancelled')} disabled={saving || !pageStatusWritable} hitSlop={6}>
                  <Text style={styles.statusLink}>cancel this event</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <BrandedAlert
        visible={!!alertInfo}
        scrollMessage
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
        onDismiss={() => requestAnimationFrame(scrollToRecovery)}
        appearance={{fonts, variant: 'creator'}}
      />
    </SafeAreaView>
  );
}

function eventFormStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  previewAction: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  statusLine: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.secondary, marginBottom: 12 },
  savedLine: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.text2, marginBottom: 12 },
  // Golden Hour: same white-card/terracotta-border shape as CreatorSpaceBanner
  ticketNudge: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ticketNudgeBody: { flex: 1, gap: 2 },
  ticketNudgeTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  ticketNudgeMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
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
  reviewTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.text1, marginBottom: EventSpacing.xs },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: EventSpacing.sm },
  reviewItem: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.text2 },
  reviewItemDone: { color: Colors.brandDeep },
  // doc 76 §3: sections carry the rhythm; labels stop shouting
  // terracotta on every field and go quiet and tracked
  sectionHeader: {
    fontFamily: fonts.semibold,
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
  recoveryCard: { marginBottom: 16, paddingBottom: 16, borderColor: CreatorSurfaceColors.goldEdge, overflow: 'hidden' },
  recoveryAction: { minHeight: 44, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center', alignItems: 'center', marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24, backgroundColor: Colors.terracotta, overflow: 'hidden' },
  recoveryActionText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.white },
  recoveryCopy: { color: Colors.asphalt },
  recoveryRetry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 4, paddingHorizontal: 4 },
  headerBack: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerPreview: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end', marginHorizontal: 12 },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginBottom: 6,
  },
  permissionNote: { fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, fontFamily: fonts.regular, color: Colors.secondary, marginBottom: 20 },
  fieldHint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary, marginBottom: 6 },
  // doc 111: the multiline "after they buy" message
  inputTall: { minHeight: 96, textAlignVertical: 'top' },
  input: {
    backgroundColor: Colors.parchment,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: fonts.regular,
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
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 18,
  },
  pickerBlock: { marginBottom: 14 },
  clearTimeAction: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  clearTimeLink: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  // §3.1 cover: the page's face. doc 80 makes media the ONE warm-dark
  // surface, so the empty drop-zone is dark cream-on-warm, reading as the
  // hero of a page rather than another grey form field.
  cover: { width: '100%', aspectRatio: POSTER_ASPECT, borderRadius: 16, marginBottom: EventSpacing.md },
  coverAdd: {
    aspectRatio: POSTER_ASPECT,
    borderRadius: 16,
    backgroundColor: EventSurface.media,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: EventSpacing.md,
    gap: 8,
    paddingHorizontal: 24,
  },
  coverAddLabel: { fontFamily: fonts.display, fontSize: FontSizes.displaySM, color: EventSurface.onMedia },
  coverAddHint: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: EventSurface.onMediaMuted, textAlign: 'center' },
  // the seam between the open editorial page-zone and the logistics cards
  zoneDivider: { height: 1, backgroundColor: Colors.border, marginTop: EventSpacing.lg, marginBottom: EventSpacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    minHeight: 44, justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipDisabled: { opacity: 0.45 },
  chipText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  chipTextDisabled: { color: Colors.tertiary },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
    marginTop: 12,
  },
  linkRowText: { flex: 1, gap: 2 },
  linkRowTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  linkRowHint: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.secondary },
  saveBtn: {
    minHeight: 48, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge,
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 3,
    backgroundColor: Colors.terracotta,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.white },
  quietLinkWrap: { alignItems: 'center', marginTop: 12 },
  quietLink: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  statusAction: { flexGrow: 1, flexBasis: 140, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg },
  statusLink: { textAlign: 'center', fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.secondary },
}); }
