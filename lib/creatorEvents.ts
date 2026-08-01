/**
 * Operator event create and edit, against the batch-15 RPCs.
 *
 * THE FULL-OVERWRITE CONTRACT (from the operator_update_explore_event
 * function comment): every omitted optional param NULLS its column, matching
 * the admin twin. So updateOperatorEvent takes the COMPLETE field set, never
 * a partial patch, and the form always loads every field before saving.
 *
 * Attribution (community vs just you) is set at create and not editable
 * (batch 15 deliberate call e). Operator events publish straight to Live
 * (call a: the grant is the vetting). Posters go to the event-images bucket
 * under the uploader's uid folder (existing policy).
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { uploadBase64ToStorage } from './uploadPhoto';
import { type DescriptionBlock } from './eventContent';

// LIZ COPY: starter event categories (taste call 1)
export const EVENT_CATEGORIES = [
  'music',
  'comedy',
  'nightlife',
  'food and drink',
  'art',
  'fitness and outdoors',
  'community',
  'film',
  'markets',
  'gaming',
];

export interface OperatorEventFields {
  title: string;
  description: string;
  image_url: string;
  event_date: string;      // YYYY-MM-DD or ''
  start_time: string | null; // ISO timestamptz or null
  // §3.3 end: the payout-release wall's timing input. The column and both
  // operator RPCs' p_end_time already exist on prod (read 2026-07-26); this
  // is the client catching up, no schema change. ISO timestamptz or null.
  end_time: string | null;
  venue: string;
  venue_address: string;
  category: string;
  external_url: string;
  ticket_price: string;
  public_name: string;
  pin_to_chat: boolean;
  /** proposal 77: the rich body rides the SAME full-overwrite payload.
   *  77's documented deviation - null leaves the stored body untouched,
   *  [] clears it - so undefined here means "leave it alone". */
  description_blocks?: DescriptionBlock[] | null;
  /** doc 111: the "after they buy" message. undefined = the SQL-96 door is
   *  closed and the param is NEVER sent (pre-apply saves are byte-identical
   *  to today); string/null only once the column probe succeeded. */
  after_purchase_message?: string | null;
}

// ─── doc 111: the "after they buy" message (SQL-96, at the seat's gate) ───
// SEAT BINDING REQUIRED: these two identifiers are the client's read of
// SQL-96's names, written before the proposal's bytes were readable. Verify
// against the applied proposal and rebind HERE if they differ. Until the
// column exists on prod every door below stays closed (the join-gate
// pattern), so a wrong name is inert: the field never renders, the param is
// never sent, and no organizer text can be silently dropped.
export const AFTER_PURCHASE_COLUMN = 'after_purchase_message';
const AFTER_PURCHASE_RPC_PARAM = 'p_after_purchase_message';

/**
 * The door probe + value read in one query. Edit passes the event id and
 * gets the stored message back; create probes with a 1-row read. A missing
 * column (SQL-96 not applied) reads as door-closed, never as an error.
 */
export async function probeAfterPurchase(
  eventId?: string | null,
): Promise<{ open: boolean; value: string | null }> {
  let q = supabase.from('explore_events').select(AFTER_PURCHASE_COLUMN).limit(1);
  if (eventId) q = q.eq('id', eventId);
  const { data, error } = await q;
  if (error) return { open: false, value: null };
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  const raw = eventId && row ? row[AFTER_PURCHASE_COLUMN] : null;
  return { open: true, value: typeof raw === 'string' && raw.trim() ? raw : null };
}

export interface OperatorEventRow extends OperatorEventFields {
  id: string;
  status: string;
  community_id: string | null;
  host_user_id: string | null;
  // proposal 35: place-picker coordinates, null on legacy rows; not part of
  // OperatorEventFields because they ride their own RPC, never the
  // full-overwrite payload
  latitude: number | null;
  longitude: number | null;
}

export async function getOperatorEvent(eventId: string): Promise<OperatorEventRow | null> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, description, description_blocks, image_url, event_date, start_time, end_time, venue, venue_address, category, external_url, ticket_price, public_name, pin_to_chat, status, community_id, host_user_id, latitude, longitude')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title ?? '',
    description: data.description ?? '',
    image_url: data.image_url ?? '',
    event_date: data.event_date ?? '',
    start_time: data.start_time ?? null,
    end_time: data.end_time ?? null,
    venue: data.venue ?? '',
    venue_address: data.venue_address ?? '',
    category: data.category ?? '',
    external_url: data.external_url ?? '',
    ticket_price: data.ticket_price != null ? String(data.ticket_price) : '',
    public_name: data.public_name ?? '',
    pin_to_chat: data.pin_to_chat ?? true,
    // 77: the stored body must round-trip through an edit, or an untouched
    // save would send [] and clear it
    description_blocks: Array.isArray(data.description_blocks) ? data.description_blocks : null,
    status: data.status,
    community_id: data.community_id ?? null,
    host_user_id: data.host_user_id ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
  };
}

/**
 * Proposal 35: coordinates ride their own owner-or-leader RPC right after a
 * create or save, never the full-overwrite payload. A null pair clears them
 * (venue retyped by hand). Server insists they travel as a pair.
 */
export async function setOperatorEventCoords(
  eventId: string,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('operator_set_explore_event_coords', {
    p_event_id: eventId,
    p_latitude: lat,
    p_longitude: lng,
  });
  if (error) throw error;
}

export async function createOperatorEvent(
  fields: OperatorEventFields,
  communityId: string | null,
  publish: boolean = true,
): Promise<string> {
  // doc 111: the param rides ONLY when the door probe opened the field
  // (undefined = never sent), so a pre-SQL-96 call is byte-identical to today
  const afterPurchase =
    fields.after_purchase_message !== undefined
      ? { [AFTER_PURCHASE_RPC_PARAM]: fields.after_purchase_message }
      : {};
  const { data, error } = await supabase.rpc('operator_create_explore_event', {
    ...afterPurchase,
    p_title: fields.title,
    p_description: fields.description || null,
    p_image_url: fields.image_url || null,
    p_event_date: fields.event_date || null,
    p_start_time: fields.start_time,
    p_end_time: fields.end_time,
    p_venue: fields.venue || null,
    p_venue_address: fields.venue_address || null,
    p_category: fields.category || null,
    p_external_url: fields.external_url || null,
    p_ticket_price: fields.ticket_price || null,
    p_community_id: communityId,
    p_public_name: fields.public_name || null,
    p_pin_to_chat: fields.pin_to_chat,
    p_publish: publish,
    p_description_blocks: fields.description_blocks ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** FULL-OVERWRITE: always pass the complete field set (see file header). */
export async function updateOperatorEvent(
  eventId: string,
  fields: OperatorEventFields,
  status: string | null,
): Promise<void> {
  // doc 111: same conditional ride as create (see there)
  const afterPurchase =
    fields.after_purchase_message !== undefined
      ? { [AFTER_PURCHASE_RPC_PARAM]: fields.after_purchase_message }
      : {};
  const { error } = await supabase.rpc('operator_update_explore_event', {
    ...afterPurchase,
    p_event_id: eventId,
    p_title: fields.title,
    p_description: fields.description || null,
    p_image_url: fields.image_url || null,
    p_event_date: fields.event_date || null,
    p_start_time: fields.start_time,
    p_end_time: fields.end_time,
    p_venue: fields.venue || null,
    p_venue_address: fields.venue_address || null,
    p_category: fields.category || null,
    p_external_url: fields.external_url || null,
    p_ticket_price: fields.ticket_price || null,
    p_public_name: fields.public_name || null,
    p_pin_to_chat: fields.pin_to_chat,
    p_status: status,
    p_description_blocks: fields.description_blocks ?? null,
  });
  if (error) throw error;
}

// -- templates (batch 20): a template is the form's field set, owner-only ----

export interface EventTemplate {
  id: string;
  name: string;
  community_id: string | null;
  fields: OperatorEventFields;
  created_at: string;
}

export async function listEventTemplates(): Promise<EventTemplate[]> {
  const { data, error } = await supabase
    .from('operator_event_templates')
    .select('id, name, community_id, fields, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventTemplate[];
}

/** Saves the current form as a template; date and time never travel. */
export async function saveEventTemplate(
  name: string,
  fields: OperatorEventFields,
  communityId: string | null,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('operator_event_templates').insert({
    user_id: user.id,
    community_id: communityId,
    name: name.trim().slice(0, 80),
    // a template is the reusable clothes, never a specific instant: date,
    // start, and end all reset so a re-used template asks for fresh times
    fields: { ...fields, event_date: '', start_time: null, end_time: null },
  });
  if (error) throw error;
}

export async function getEventTemplate(id: string): Promise<EventTemplate | null> {
  const { data, error } = await supabase
    .from('operator_event_templates')
    .select('id, name, community_id, fields, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as EventTemplate | null) ?? null;
}

export async function deleteEventTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('operator_event_templates').delete().eq('id', id);
  if (error) throw error;
}

/** "tell your members": leader-only, Live-only, one-shot (batch 15 call l). */
export async function announceEventToMembers(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('notify_community_event', { p_event_id: eventId });
  if (error) throw error;
}

/** Pick, compress, and upload an event poster. Returns the public URL or null on cancel. */
export async function pickAndUploadEventImage(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  return uploadBase64ToStorage('event-images', `${user.id}/${Crypto.randomUUID()}.jpg`, manipulated.base64);
}
