import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as base64ToArrayBuffer } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from './supabase';

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
  storagePath: string;            // {event_id}/{user_id}/{upload_id}/original.{ext}
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'permanently_failed';
  attempts: number;
  error?: string;
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
          await uploadOne(item);
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
        } catch (err) {
          // RPC failure leaves batch in queue; next foreground retries.
          await persistQueueWithBatch(batch);
          break;
        }
      }

      if (batch.rpcCalled) {
        // Done — remove from queue.
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

async function uploadOne(item: QueueItem): Promise<void> {
  let arrayBuffer: ArrayBuffer;
  let httpContentType: string;

  if (item.contentType === 'photo') {
    // Re-encode to JPEG for consistency. ImageManipulator handles HEIC/HEIF/PNG
    // and any other format expo-image-picker hands us.
    const result = await ImageManipulator.manipulateAsync(
      item.localUri,
      [],
      { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG, base64: true },
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
}

export async function clearAlbumBatch(batchId: string): Promise<void> {
  const q = await readQueue();
  q.batches = q.batches.filter((b) => b.batchId !== batchId);
  await writeQueue(q);
}
