import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as base64ToArrayBuffer } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { AppState, AppStateStatus, Image } from 'react-native';
import { supabase } from './supabase';
import { queryClient } from './queryClient';

// Album upload orchestrator. Handles a multi-file upload batch:
//   1. Each file is added to the AsyncStorage queue with status 'pending'.
//   2. A worker walks the queue; for each item:
//      - photos: re-encode to JPEG via ImageManipulator (handles HEIC/HEIF/PNG/etc)
//      - videos: read raw bytes via fetch(uri).arrayBuffer()
//      - upload to album-media/{event_id}/{user_id}/{upload_id}/original.{ext}
//      - mark status='uploaded'
//   3. When every item in the batch is 'uploaded', call start_album_upload_batch
//      RPC and clear the batch from the queue.
//
// Resume on app foreground is wired via AppState. If a batch is partially
// done when the app is killed, calling resumeAllPendingAlbumBatches() on
// the next launch picks up where we left off. Items already uploaded are
// skipped (status='uploaded' but RPC not yet sent).

const QUEUE_KEY = 'albumUpload.queueV1';
const BUCKET = 'album-media';
const MARKETING_BUCKET = 'marketing-media';

export type AlbumUploadInput = {
  // Local file URI from expo-image-picker
  localUri: string;
  // 'photo' or 'video'
  contentType: 'photo' | 'video';
  // Original file extension (without dot) — heic, jpg, mov, mp4, etc.
  mediaFormat: string;
  // Bytes (asset.fileSize from expo-image-picker; may be undefined → fill at upload time)
  fileSizeBytes?: number;
  // Video duration in seconds (≤ 60). Photos: undefined.
  videoDurationSec?: number;
  // Source pixel dims (asset.width/height) for the mosaic aspect ratio.
  width?: number;
  height?: number;
  // EXIF DateTimeOriginal normalized to a UTC ISO string; chronological sort only.
  takenAt?: string;
};

export type AlbumUploadOptions = {
  visibleToUserIds: string[];      // attendee IDs not toggled off
  marketingConsent: boolean;
  instagram?: string;
  tiktok?: string;
  testimonial?: string;
};

const MAX_UPLOAD_ATTEMPTS = 3;

type QueueItem = {
  uploadId: string;
  batchId: string;
  eventId: string;
  userId: string;
  localUri: string;
  contentType: 'photo' | 'video';
  mediaFormat: string;
  fileSizeBytes: number;          // resolved at enqueue time (best-effort)
  videoDurationSec?: number;
  width?: number;
  height?: number;
  takenAt?: string;
  storagePath: string;            // {event_id}/{user_id}/{upload_id}/original.{ext}
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'permanently_failed';
  attempts: number;
  error?: string;
  originalUploaded?: boolean;     // photos: full-res original (+marketing) uploaded
  originalAttempts?: number;      // retry counter for the background original
};

type Batch = {
  batchId: string;
  eventId: string;
  userId: string;
  options: AlbumUploadOptions;
  items: QueueItem[];
  rpcCalled: boolean;             // true once start_album_upload_batch returned
  createdAt: number;
};

type Queue = { batches: Batch[] };

// ─── Queue persistence ──────────────────────────────────────────────────────

async function readQueue(): Promise<Queue> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return { batches: [] };
  try { return JSON.parse(raw) as Queue; }
  catch { return { batches: [] }; }
}

async function writeQueue(q: Queue): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function enqueueAlbumUploadBatch(
  eventId: string,
  userId: string,
  inputs: AlbumUploadInput[],
  options: AlbumUploadOptions,
): Promise<{ batchId: string }> {
  if (inputs.length === 0) throw new Error('enqueueAlbumUploadBatch: empty inputs');

  const batchId = Crypto.randomUUID();
  const items: QueueItem[] = inputs.map((input) => {
    const uploadId = Crypto.randomUUID();
    const ext = input.contentType === 'photo' ? 'jpg' : (input.mediaFormat || 'mp4');
    return {
      uploadId,
      batchId,
      eventId,
      userId,
      localUri: input.localUri,
      contentType: input.contentType,
      mediaFormat: input.mediaFormat,
      fileSizeBytes: input.fileSizeBytes ?? 0,
      videoDurationSec: input.videoDurationSec,
      width: input.width,
      height: input.height,
      takenAt: input.takenAt,
      storagePath: `${eventId}/${userId}/${uploadId}/original.${ext}`,
      status: 'pending',
      attempts: 0,
    };
  });

  const queue = await readQueue();
  queue.batches.push({
    batchId, eventId, userId, options, items,
    rpcCalled: false,
    createdAt: Date.now(),
  });
  await writeQueue(queue);

  // Kick off processing (don't await — caller returns immediately).
  void processQueue();

  return { batchId };
}

export async function getBatchStatus(batchId: string): Promise<{
  total: number;
  uploaded: number;
  failed: number;
  permanentlyFailed: number;
  rpcCalled: boolean;
} | null> {
  const queue = await readQueue();
  const batch = queue.batches.find((b) => b.batchId === batchId);
  if (!batch) return null;
  return {
    total: batch.items.length,
    uploaded: batch.items.filter((i) => i.status === 'uploaded').length,
    failed: batch.items.filter((i) => i.status === 'failed').length,
    permanentlyFailed: batch.items.filter((i) => i.status === 'permanently_failed').length,
    rpcCalled: batch.rpcCalled,
  };
}

export async function resumeAllPendingAlbumBatches(): Promise<void> {
  void processQueue();
}

// AppState wiring: nudges the worker whenever the app comes back to foreground.
// Call once at app startup (e.g. from app/_layout.tsx).
export function registerAlbumUploadResume(): () => void {
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') void processQueue();
  });
  return () => sub.remove();
}

// ─── Worker ─────────────────────────────────────────────────────────────────

let workerRunning = false;

async function processQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    let queue = await readQueue();
    while (queue.batches.length > 0) {
      const batch = queue.batches[0];

      // Upload any items still pending or in 'uploading' (treat as crash-recovered).
      for (let i = 0; i < batch.items.length; i++) {
        const item = batch.items[i];
        if (item.status === 'uploaded' || item.status === 'permanently_failed') continue;

        // Only count this as a NEW attempt when transitioning from pending →
        // uploading. A status of 'uploading' on disk means the worker crashed
        // mid-upload last time, so the previous attempt already consumed an
        // attempt slot — don't burn another one on resume. Without this guard
        // a single crash drops the user's remaining retries from 3 to 1.
        const isResumingFromCrash = item.status === 'uploading';
        item.status = 'uploading';
        if (!isResumingFromCrash) item.attempts += 1;
        await persistQueueWithBatch(batch);

        try {
          await uploadOne(item, batch.options.marketingConsent);
          item.status = 'uploaded';
          item.error = undefined;
        } catch (err) {
          item.error = err instanceof Error ? err.message : String(err);
          item.status = item.attempts >= MAX_UPLOAD_ATTEMPTS ? 'permanently_failed' : 'failed';
        }
        await persistQueueWithBatch(batch);
      }

      const uploadedCount = batch.items.filter((i) => i.status === 'uploaded').length;
      const transientFailures = batch.items.filter((i) => i.status === 'failed').length;
      const permanentFailures = batch.items.filter((i) => i.status === 'permanently_failed').length;

      // Drop permanently-failed items from the batch — without them, the rest
      // can still complete the RPC. If everything permanently failed, abandon
      // the batch entirely (caller can re-enqueue).
      if (permanentFailures > 0 && uploadedCount === 0) {
        const q = await readQueue();
        q.batches = q.batches.filter((b) => b.batchId !== batch.batchId);
        await writeQueue(q);
        break;
      }
      if (permanentFailures > 0) {
        batch.items = batch.items.filter((i) => i.status !== 'permanently_failed');
        await persistQueueWithBatch(batch);
      }

      // Transient failures: reset to pending so the next foreground retries.
      if (transientFailures > 0) {
        for (const item of batch.items) {
          if (item.status === 'failed') item.status = 'pending';
        }
        await persistQueueWithBatch(batch);
        break;  // exit while; resume on next foreground
      }

      // All uploaded — call the RPC (idempotency: check rpcCalled).
      if (!batch.rpcCalled && uploadedCount === batch.items.length) {
        try {
          await callStartBatchRpc(batch);
          batch.rpcCalled = true;
          await persistQueueWithBatch(batch);
        } catch (err) {
          // RPC failure leaves batch in queue; next foreground retries.
          await persistQueueWithBatch(batch);
          break;
        }
      }

      if (batch.rpcCalled) {
        // Background originals phase: the display versions are live and the grid
        // is populated (RPC done). Now upload each photo's full-res original
        // (and its marketing copy, from that original). A failure here does not
        // wedge the batch — it retries on the next foreground, then gives up
        // after the attempt cap so a permanently broken original can't pin the
        // batch in the queue. Videos already uploaded their original inline.
        let originalsPending = false;
        for (const item of batch.items) {
          if (item.contentType !== 'photo' || item.originalUploaded) continue;
          if ((item.originalAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS) continue;
          item.originalAttempts = (item.originalAttempts ?? 0) + 1;
          try {
            await uploadOriginalAndMarketing(item, batch.options.marketingConsent);
            item.originalUploaded = true;
          } catch {
            originalsPending = true;
          }
          await persistQueueWithBatch(batch);
        }
        if (originalsPending) break;  // retry remaining originals on next foreground

        // RPC done and originals settled — remove from queue.
        queue = await readQueue();
        queue.batches = queue.batches.filter((b) => b.batchId !== batch.batchId);
        await writeQueue(queue);
      }
    }
  } finally {
    workerRunning = false;
  }
}

async function persistQueueWithBatch(batch: Batch): Promise<void> {
  const q = await readQueue();
  const idx = q.batches.findIndex((b) => b.batchId === batch.batchId);
  if (idx >= 0) {
    q.batches[idx] = batch;
    await writeQueue(q);
  }
}

async function uploadOne(item: QueueItem, marketingConsent: boolean): Promise<void> {
  let arrayBuffer: ArrayBuffer;
  let httpContentType: string;

  if (item.contentType === 'photo') {
    // DISPLAY version: downscale the longest edge to 2048 and re-encode JPEG at
    // 0.7 (visually identical on phones, ~60-70% smaller). The full-res ORIGINAL
    // is uploaded later by the originals phase, read from item.localUri (the
    // untouched picker URI) — NOT this manipulated output. ImageManipulator
    // handles HEIC/HEIF/PNG and anything else the picker hands us.
    const actions: ImageManipulator.Action[] = [];
    try {
      const { width, height } = await getImageSize(item.localUri);
      if (Math.max(width, height) > MAX_PHOTO_EDGE) {
        actions.push(width >= height ? { resize: { width: MAX_PHOTO_EDGE } } : { resize: { height: MAX_PHOTO_EDGE } });
      }
    } catch {
      // dimensions unavailable (e.g. some HEIC); skip resize, still re-encode + compress
    }
    const result = await ImageManipulator.manipulateAsync(
      item.localUri,
      actions,
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) throw new Error('ImageManipulator returned no base64');
    arrayBuffer = base64ToArrayBuffer(result.base64);
    httpContentType = 'image/jpeg';
  } else {
    // Video: read raw bytes via fetch(file://). RN's whatwg-fetch supports
    // arrayBuffer() reliably for file:// URIs (the broken path is .blob()).
    const res = await fetch(item.localUri);
    arrayBuffer = await res.arrayBuffer();
    httpContentType = guessVideoMime(item.mediaFormat);
  }

  if (!item.fileSizeBytes) item.fileSizeBytes = arrayBuffer.byteLength;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(item.storagePath, arrayBuffer, {
      contentType: httpContentType,
      upsert: false,
    });

  // 23505 / "already exists" = treat as success (resume case).
  if (error && !/already exists/i.test(error.message)) throw error;

  // Videos: the uploaded file IS the original, so the marketing copy is made
  // here from the same bytes. Photos defer their marketing copy to the originals
  // phase, which copies the full-res original (never the compressed display).
  if (marketingConsent && item.contentType === 'video') {
    await copyToMarketing(item.storagePath, arrayBuffer, httpContentType);
  }
}

// Best-effort marketing copy. Failures never block the batch or the user; the
// path mirrors album-media so the marketing bucket structure matches it.
async function copyToMarketing(path: string, buffer: ArrayBuffer, contentType: string): Promise<void> {
  try {
    const { error } = await supabase.storage
      .from(MARKETING_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error && !/already exists/i.test(error.message)) {
      console.warn('[albumUpload] marketing-media copy failed for', path, ':', error.message);
    }
  } catch (err) {
    console.warn('[albumUpload] marketing-media copy threw:', err);
  }
}

const MAX_PHOTO_EDGE = 2048;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

const PHOTO_MIME: Record<string, string> = {
  heic: 'image/heic', heif: 'image/heif', png: 'image/png',
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

// Upload the full-res ORIGINAL (raw picker file, no compression/resize) to an
// originals/ prefix in album-media, plus the marketing copy. Reads item.localUri
// (the untouched picker URI), never the manipulated display output.
async function uploadOriginalAndMarketing(item: QueueItem, marketingConsent: boolean): Promise<void> {
  const res = await fetch(item.localUri);
  const raw = await res.arrayBuffer();
  const ext = (item.mediaFormat || 'jpg').toLowerCase();
  const contentType = PHOTO_MIME[ext] ?? 'image/jpeg';
  const originalPath = `${item.eventId}/${item.userId}/${item.uploadId}/originals/source.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(originalPath, raw, { contentType, upsert: true });
  if (error && !/already exists/i.test(error.message)) throw error;
  if (marketingConsent) await copyToMarketing(originalPath, raw, contentType);
}

function guessVideoMime(format: string): string {
  const f = (format || '').toLowerCase();
  if (f === 'mov' || f === 'qt') return 'video/quicktime';
  if (f === 'm4v') return 'video/x-m4v';
  if (f === 'webm') return 'video/webm';
  if (f === '3gp') return 'video/3gpp';
  if (f === 'mkv') return 'video/x-matroska';
  if (f === 'avi') return 'video/x-msvideo';
  return 'video/mp4';
}

async function callStartBatchRpc(batch: Batch): Promise<void> {
  const uploadsPayload = batch.items.map((item) => ({
    id: item.uploadId,
    media_url: item.storagePath,
    content_type: item.contentType,
    media_format: item.mediaFormat,
    file_size_bytes: item.fileSizeBytes,
    video_duration_sec: item.videoDurationSec ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    taken_at: item.takenAt ?? null,
  }));

  const { error } = await supabase.rpc('start_album_upload_batch', {
    p_event_id: batch.eventId,
    p_uploads: uploadsPayload,
    p_visible_to_user_ids: batch.options.visibleToUserIds,
    p_marketing_consent: batch.options.marketingConsent,
    p_instagram: batch.options.instagram ?? null,
    p_tiktok: batch.options.tiktok ?? null,
    p_testimonial: batch.options.testimonial ?? null,
  });
  if (error) throw error;

  // The album upload path had NO React Query cache invalidation; the
  // unconditional focus-refetch in AlbumsGrid (removed in the 2026-05-18
  // perf fix) was the only thing refreshing the grid after an upload.
  // Invalidate explicitly so the grid + album detail reflect the new
  // upload without waiting for staleTime. Runs in a detached worker, but
  // queryClient is the app-wide singleton so this is safe post-unmount.
  queryClient.invalidateQueries({ queryKey: ['albumsGrid', batch.userId] });
  queryClient.invalidateQueries({ queryKey: ['album', batch.eventId] });
}

export async function clearAlbumBatch(batchId: string): Promise<void> {
  const q = await readQueue();
  q.batches = q.batches.filter((b) => b.batchId !== batchId);
  await writeQueue(q);
}
