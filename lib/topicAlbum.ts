/**
 * SC-09/C-24: photo/video albums for event-chat topics (migration
 * 20260818170000_event_chat_topic_albums.sql -- tables
 * community_topic_albums / community_topic_album_uploads, RPCs
 * start_topic_album_upload_batch / soft_delete_topic_album_upload, private
 * bucket topic-album-media). Reported applied on 2026-08-24; the live
 * fingerprint and migration-ledger disposition remain unverified.
 *
 * Self-flipping (house canon, the proposal-49 pattern lib/organizerFollows.ts
 * documents): every read below treats a missing-relation/function error as
 * "not live yet" and degrades to an empty, available:false result instead
 * of throwing. The album screen renders that as an honest "not live yet"
 * state today; the moment the migration applies it wakes with zero client
 * deploy. Writes (upload, delete) are real user actions -- a tap on "add
 * photos" -- so they throw on failure like every other write in this
 * codebase; the screen shows the normal friendly-error alert, same as
 * community-topic's send/delete handlers.
 *
 * Deliberately its own smaller model, not lib/uploadAlbumMedia.ts's
 * plan_albums pipeline: different event model (explore_events/community
 * topics, not the Plans events table), no marketing consent, no heart
 * reactions, no per-viewer visibility, no background retry queue -- see the
 * migration's own header for the full reasoning.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { decode as base64ToArrayBuffer } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

const BUCKET = 'topic-album-media';
const SIGNED_URL_TTL = 7200; // 2h, matches the plan_albums precedent
const THUMB_TRANSFORM = { width: 400, height: 400, resize: 'cover' as const, quality: 70 };
export const MAX_PHOTO_EDGE = 1600;

/** PostgREST "relation/function does not exist": the migration hasn't applied. */
function isMissingSchema(code: string | undefined): boolean {
  return code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202';
}

export interface TopicAlbumUpload {
  id: string;
  userId: string;
  uploaderName: string | null;
  contentType: 'photo' | 'video';
  /** null for video (no frame-extraction thumb yet, matches the plan_albums stub) or a failed sign. */
  signedThumbUrl: string | null;
  signedDisplayUrl: string | null;
  createdAt: string;
}

export interface TopicAlbum {
  /** false only when the schema itself is not live -- the one case the screen should explain, not treat as "just empty". */
  available: boolean;
  uploads: TopicAlbumUpload[];
}

export async function getTopicAlbum(topicId: string): Promise<TopicAlbum> {
  const { data: album, error: albumErr } = await supabase
    .from('community_topic_albums')
    .select('id')
    .eq('topic_id', topicId)
    .maybeSingle();
  if (albumErr) {
    if (isMissingSchema((albumErr as { code?: string }).code)) return { available: false, uploads: [] };
    return { available: true, uploads: [] };
  }
  // no album row yet just means nobody has uploaded (the row is born lazily
  // on first upload, per the RPC's own on-conflict-upsert) -- a real empty
  // state, not an error
  if (!album) return { available: true, uploads: [] };

  const { data: rows, error: uploadsErr } = await supabase
    .from('community_topic_album_uploads')
    .select('id, user_id, media_url, display_url, content_type, created_at')
    .eq('topic_album_id', album.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (uploadsErr || !rows || rows.length === 0) return { available: true, uploads: [] };

  const userIds = Array.from(new Set(rows.map((u) => u.user_id)));
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display')
    .in('id', userIds);
  const nameById = new Map((profiles ?? []).map((p: any) => [p.id as string, p.first_name_display as string | null]));

  const uploads = await Promise.all(
    rows.map(async (u): Promise<TopicAlbumUpload> => {
      const path = (u.display_url as string | null) || (u.media_url as string);
      const isPhoto = u.content_type === 'photo';
      let displayUrl: string | null = null;
      let thumbUrl: string | null = null;
      try {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
        displayUrl = data?.signedUrl ?? null;
      } catch {
        // one bad signed URL should not take the whole album down; that
        // tile just renders without an image
      }
      if (isPhoto) {
        try {
          const { data } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL, { transform: THUMB_TRANSFORM });
          thumbUrl = data?.signedUrl ?? displayUrl;
        } catch {
          thumbUrl = displayUrl;
        }
      }
      return {
        id: u.id as string,
        userId: u.user_id as string,
        uploaderName: nameById.get(u.user_id as string) ?? null,
        contentType: u.content_type as 'photo' | 'video',
        signedThumbUrl: thumbUrl,
        signedDisplayUrl: displayUrl,
        createdAt: u.created_at as string,
      };
    }),
  );

  return { available: true, uploads };
}

export interface TopicAlbumUploadInput {
  localUri: string;
  contentType: 'photo' | 'video';
  /** original extension, without the dot -- heic, jpg, mov, mp4, etc. */
  mediaFormat: string;
}

/**
 * Compresses photos (ImageManipulator, mirrors pickAndUploadEventImage in
 * lib/creatorEvents.ts), uploads each straight through (no background
 * retry queue -- see file header), then registers the batch in one RPC
 * call. media_url is built as {topic_id}/{user_id}/{upload_id}/original.ext,
 * exactly the shape start_topic_album_upload_batch's own path check
 * requires. A real user action; throws on failure like every other write
 * here, for the caller's normal error alert.
 */
export async function uploadTopicAlbumMedia(topicId: string, inputs: TopicAlbumUploadInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const uploadedPaths: string[] = [];
  const attempts = await Promise.allSettled(
    inputs.map(async (input) => {
      const uploadId = Crypto.randomUUID();
      const ext = input.contentType === 'photo' ? 'jpg' : (input.mediaFormat || 'mp4').toLowerCase();
      const path = `${topicId}/${user.id}/${uploadId}/original.${ext}`;

      let bytes: ArrayBuffer;
      let httpContentType: string;
      if (input.contentType === 'photo') {
        const result = await ImageManipulator.manipulateAsync(
          input.localUri,
          [{ resize: { width: MAX_PHOTO_EDGE } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (!result.base64) throw new Error('could not process that photo');
        bytes = base64ToArrayBuffer(result.base64);
        httpContentType = 'image/jpeg';
      } else {
        const res = await fetch(input.localUri);
        bytes = await res.arrayBuffer();
        httpContentType = 'video/mp4';
      }

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: httpContentType, upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);

      return {
        id: uploadId,
        media_url: path,
        content_type: input.contentType,
        media_format: input.mediaFormat || ext,
        file_size_bytes: bytes.byteLength,
      };
    }),
  );

  const failed = attempts.find((attempt) => attempt.status === 'rejected');
  if (failed) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(BUCKET).remove(uploadedPaths);
    }
    throw failed.reason;
  }

  const payload = attempts.map((attempt) => {
    if (attempt.status !== 'fulfilled') throw new Error('album upload did not finish');
    return attempt.value;
  });

  const { error } = await supabase.rpc('start_topic_album_upload_batch', {
    p_topic_id: topicId,
    p_uploads: payload,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove(uploadedPaths);
    throw error;
  }
}

export async function softDeleteTopicAlbumUpload(uploadId: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_topic_album_upload', { p_upload_id: uploadId });
  if (error) throw error;
}

/**
 * SC-09/C-24: room-level album on/off, creator-only (RPC enforces the
 * host_user_id check server-side, same as every other write here -- this
 * just surfaces a normal write error on failure).
 */
export async function setTopicAlbumEnabled(topicId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_topic_album_enabled', { p_topic_id: topicId, p_enabled: enabled });
  if (error) throw error;
}
