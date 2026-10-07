/** Private page covers. Persist the attempt before any remote write; never return a public/signed URL. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { decode, encode } from 'base64-arraybuffer';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export const CREATOR_PAGE_MEDIA_BUCKET = 'creator-page-media';
export interface PageCoverAttempt {
  pageId: string; mediaId: string; fileUri: string; byteSize: number;
  mimeType: 'image/jpeg'; digest: string;
}
export interface PageCoverMedia {
  id: string; page_id: string; object_name: string; byte_size: number; mime_type: string;
  created_by: string | null; ready_at: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
async function account(scope: CreatorPageScope) {
  current(scope); const result = await requestWithDeadline(supabase.auth.getUser(), 12_000); current(scope);
  if (result.error || result.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
const storageKey = (pageId: string, scope: CreatorPageScope) => `creator-page-cover:v1:${scope.userId}:${pageId}`;
function filePath(pageId: string, mediaId: string, scope: CreatorPageScope) {
  if (!FileSystem.documentDirectory || !uuid.test(pageId) || !uuid.test(mediaId) || !uuid.test(scope.userId)) throw new Error('Photo storage is unavailable.');
  return `${FileSystem.documentDirectory}creator-page-covers/${scope.userId}/${pageId}/${mediaId}.jpg`;
}
function validAttempt(value: unknown, pageId: string, scope: CreatorPageScope): value is PageCoverAttempt {
  const a = value as PageCoverAttempt;
  return !!a && a.pageId === pageId && uuid.test(a.mediaId) && a.mimeType === 'image/jpeg'
    && Number.isInteger(a.byteSize) && a.byteSize > 0 && a.byteSize <= 8388608
    && typeof a.digest === 'string' && /^[a-f0-9]{64}$/.test(a.digest)
    && a.fileUri === filePath(pageId, a.mediaId, scope);
}
export async function readPageCoverAttempt(pageId: string, scope: CreatorPageScope): Promise<PageCoverAttempt | null> {
  current(scope); const raw = await AsyncStorage.getItem(storageKey(pageId, scope)); current(scope);
  if (raw === null) return null;
  const attempt: unknown = JSON.parse(raw);
  if (!validAttempt(attempt, pageId, scope)) throw new Error('The saved photo attempt could not be read. Keep this page open and try again.');
  return attempt;
}
async function pickCover(pageId: string, scope: CreatorPageScope, onPickerOpen?: (open: boolean) => void): Promise<PageCoverAttempt | null> {
  await account(scope);
  if (await readPageCoverAttempt(pageId, scope)) throw new Error('Finish the saved photo before choosing another.');
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); current(scope);
  if (!permission.granted) throw new Error('Allow photo access in Settings to choose a cover.');
  let result: ImagePicker.ImagePickerResult;
  onPickerOpen?.(true);
  try { result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false }); }
  finally { onPickerOpen?.(false); }
  current(scope);
  if (result.canceled || !result.assets?.[0]) return null;
  // Reuse the established picker -> JPEG compression path; show the whole photo.
  const image = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 1600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }); current(scope);
  if (!image.base64) throw new Error('This photo could not be prepared. Choose another photo.');
  const byteSize = decode(image.base64).byteLength;
  if (!byteSize || byteSize > 8388608) throw new Error('Choose a photo that can be saved within 8 MB.');
  const mediaId = Crypto.randomUUID(), fileUri = filePath(pageId, mediaId, scope);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, image.base64); current(scope);
  await FileSystem.makeDirectoryAsync(fileUri.slice(0, fileUri.lastIndexOf('/')), { intermediates: true }); current(scope);
  await FileSystem.copyAsync({ from: image.uri, to: fileUri }); current(scope);
  const attempt: PageCoverAttempt = { pageId, mediaId, fileUri, byteSize, digest, mimeType: 'image/jpeg' };
  await AsyncStorage.setItem(storageKey(pageId, scope), JSON.stringify(attempt)); current(scope);
  return attempt;
}
function mediaReceipt(data: unknown, pageId: string, mediaId: string): PageCoverMedia {
  const m = data as PageCoverMedia;
  if (!m || m.id !== mediaId || m.page_id !== pageId || !['image/jpeg','image/png'].includes(m.mime_type)
    || m.object_name !== `${pageId}/${mediaId}.${m.mime_type === 'image/jpeg' ? 'jpg' : 'png'}`
    || !Number.isInteger(m.byte_size) || m.byte_size < 1 || m.byte_size > 8388608
    || !(m.ready_at === null || typeof m.ready_at === 'string')) throw new Error('The saved photo could not be confirmed.');
  return m;
}
async function readMedia(pageId: string, mediaId: string, scope: CreatorPageScope) {
  await account(scope);
  const result = await requestWithDeadline(supabase.from('creator_page_media').select('id,page_id,object_name,byte_size,mime_type,created_by,ready_at').eq('id', mediaId).eq('page_id', pageId).maybeSingle(), 12_000);
  current(scope); if (result.error) throw result.error;
  return result.data ? mediaReceipt(result.data, pageId, mediaId) : null;
}
// React Native's Blob does not implement arrayBuffer; its FileReader supports data URLs.
async function coverBlobBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') return encode(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The saved photo could not be read.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !/^data:[^,]*;base64,/.test(result)) reject(new Error('The saved photo could not be read.'));
      else resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
async function matchesBytes(media: PageCoverMedia, attempt: PageCoverAttempt, scope: CreatorPageScope) {
  await account(scope);
  const result = await requestWithDeadline(supabase.storage.from(CREATOR_PAGE_MEDIA_BUCKET).download(media.object_name), 60_000); current(scope);
  if (result.error || !result.data) throw new Error('The saved photo could not be checked. Try again.');
  const base64 = await coverBlobBase64(result.data); current(scope);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64); current(scope);
  if (decode(base64).byteLength !== attempt.byteSize || digest !== attempt.digest) throw new Error('The uploaded photo does not match this saved attempt. Choose another photo.');
}
/** Read-only reconciliation: never uploads bytes or finalizes an object. */
export async function checkPageCover(attempt: PageCoverAttempt, scope: CreatorPageScope) {
  current(scope); if (!validAttempt(attempt, attempt.pageId, scope)) throw new Error('The saved photo attempt is invalid.');
  const media = await readMedia(attempt.pageId, attempt.mediaId, scope);
  if (media && (media.created_by !== scope.userId || media.byte_size !== attempt.byteSize || media.mime_type !== attempt.mimeType)) throw new Error('This saved photo belongs to a different attempt.');
  if (!media?.ready_at) return null;
  await matchesBytes(media, attempt, scope); return media;
}
/** Explicit retry reuses the same immutable name and verifies any existing bytes. */
async function uploadCover(attempt: PageCoverAttempt, scope: CreatorPageScope): Promise<PageCoverMedia> {
  const ready = await checkPageCover(attempt, scope); if (ready) return ready;
  let base64: string;
  try { base64 = await FileSystem.readAsStringAsync(attempt.fileUri, { encoding: FileSystem.EncodingType.Base64 }); }
  catch { throw new Error('The selected photo is no longer on this device. Choose another photo.'); }
  current(scope);
  if (decode(base64).byteLength !== attempt.byteSize || await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64) !== attempt.digest) throw new Error('The selected photo changed. Choose another photo.');
  await account(scope);
  const reserved = await requestWithDeadline(supabase.rpc('reserve_creator_page_media', { p_page_id: attempt.pageId, p_media_id: attempt.mediaId, p_byte_size: attempt.byteSize, p_mime_type: attempt.mimeType }), 25_000); current(scope);
  if (reserved.error) throw reserved.error;
  const media = mediaReceipt(reserved.data, attempt.pageId, attempt.mediaId);
  if (media.created_by !== scope.userId || media.byte_size !== attempt.byteSize || media.mime_type !== attempt.mimeType) throw new Error('The photo reservation did not match.');
  await account(scope);
  const uploaded = await requestWithDeadline(supabase.storage.from(CREATOR_PAGE_MEDIA_BUCKET).upload(media.object_name, decode(base64), { contentType: attempt.mimeType, upsert: false, cacheControl: '0' }), 120_000); current(scope);
  if (uploaded.error) {
    const status = Number((uploaded.error as { statusCode?: string }).statusCode ?? (uploaded.error as { status?: number }).status);
    if (status !== 409) throw uploaded.error;
    await matchesBytes(media, attempt, scope);
  }
  await account(scope);
  const completed = await requestWithDeadline(supabase.rpc('complete_creator_page_media', { p_page_id: attempt.pageId, p_media_id: attempt.mediaId }), 25_000); current(scope);
  if (completed.error) throw completed.error;
  const confirmed = mediaReceipt(completed.data, attempt.pageId, attempt.mediaId);
  if (!confirmed.ready_at || confirmed.created_by !== scope.userId || confirmed.byte_size !== attempt.byteSize || confirmed.mime_type !== attempt.mimeType) throw new Error('The photo upload has not been confirmed.');
  return confirmed;
}
/** Clear only this attempt and its app-owned local copy; never delete the remote review image. */
async function clearCoverAttempt(attempt: PageCoverAttempt, scope: CreatorPageScope) {
  const saved = await readPageCoverAttempt(attempt.pageId, scope);
  if (!saved) return;
  if (saved.mediaId !== attempt.mediaId) throw new Error('A different photo is pending.');
  current(scope); await AsyncStorage.removeItem(storageKey(attempt.pageId, scope));
  // Cleanup retains the original private path even when navigation retires its callback.
  await FileSystem.deleteAsync(saved.fileUri, { idempotent: true }).catch(() => undefined);
}
export async function loadPageCoverSource(pageId: string, mediaId: string, scope: CreatorPageScope) {
  const media = await readMedia(pageId, mediaId, scope);
  if (!media?.ready_at) throw new Error('This cover is unavailable.');
  const session = await requestWithDeadline(supabase.auth.getSession(), 12_000); current(scope);
  if (session.error || !session.data.session || session.data.session.user.id !== scope.userId) throw new CreatorPageScopeExpired();
  return { uri: `${SUPABASE_URL}/storage/v1/object/authenticated/${CREATOR_PAGE_MEDIA_BUCKET}/${media.object_name}`,
    headers: { Authorization: `Bearer ${session.data.session.access_token}`, apikey: SUPABASE_ANON_KEY } };
}

// A returning screen must not overwrite a picker/upload still finishing for this account and page.
const mutations = new Set<string>();
/** Read-only ownership includes a photo marker write that has not settled yet. */
export function pageCoverActionPending(pageId: string, scope: CreatorPageScope) {
  current(scope); return mutations.has(storageKey(pageId, scope));
}
async function mutate<T>(pageId: string, scope: CreatorPageScope, action: () => Promise<T>): Promise<T> {
  current(scope); const key = storageKey(pageId, scope);
  if (mutations.has(key)) throw new Error('A photo action is still finishing. Check its saved status before trying again.');
  mutations.add(key);
  try { return await action(); } finally { mutations.delete(key); }
}
export const pickPageCover = (pageId: string, scope: CreatorPageScope, onPickerOpen?: (open: boolean) => void) => mutate(pageId, scope, () => pickCover(pageId, scope, onPickerOpen));
export const uploadPageCover = (attempt: PageCoverAttempt, scope: CreatorPageScope) => mutate(attempt.pageId, scope, () => uploadCover(attempt, scope));
export const clearPageCoverAttempt = (attempt: PageCoverAttempt, scope: CreatorPageScope) => mutate(attempt.pageId, scope, () => clearCoverAttempt(attempt, scope));

/** Explicitly discard unreadable local metadata only; never follow a corrupt file path. */
export const resetUnreadablePageCoverAttempt = (pageId: string, scope: CreatorPageScope) => mutate(pageId, scope, async () => {
  await account(scope);
  const raw = await AsyncStorage.getItem(storageKey(pageId, scope)); current(scope);
  if (raw === null) return;
  let value: unknown; try { value = JSON.parse(raw); } catch { value = null; }
  if (validAttempt(value, pageId, scope)) throw new Error('This photo selection can be recovered. Check or discard it first.');
  await AsyncStorage.removeItem(storageKey(pageId, scope)); current(scope);
});
