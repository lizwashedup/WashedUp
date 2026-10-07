/** Recover a stopped import whose original-upload association was interrupted.
 * Uses the original preparer's exact deduplication fields; never guesses among
 * unmatched uploads or erases files while their import transport is active. */
import * as FileSystem from 'expo-file-system/legacy';
import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {readPageEventMediaAttempts, verifyPageEventMediaFile, type PageEventMediaAttempt} from './creatorPageEventMediaAttempt';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';
import {legacyEventMediaImportDirectory, type LegacyEventMediaDownload} from './legacyEventMediaImport';
import {validLegacyEventMediaSource, type LegacyEventMediaSource} from './legacyEventMediaSource';

export async function recoverStoppedLegacyEventMedia(input: {
  pageId: string; eventId: string; source: LegacyEventMediaSource; downloads: LegacyEventMediaDownload[];
  unprepared?: true;
  onOriginal: (original: PageEventMediaAttempt) => Promise<void>;
  onUnprepared: () => Promise<void>;
}, scope: CreatorPageScope) {
  const {pageId, eventId, onOriginal, onUnprepared, unprepared} = input;
  const source: LegacyEventMediaSource = JSON.parse(JSON.stringify(input.source));
  const downloads: LegacyEventMediaDownload[] = JSON.parse(JSON.stringify(input.downloads));
  if (!validLegacyEventMediaSource(source) || !Array.isArray(downloads) || unprepared !== undefined && unprepared !== true) throw Error('Check the original import files.');
  const folders = downloads.map(run => legacyEventMediaImportDirectory(pageId, eventId, source, run, scope));
  const release = claimPageEventMediaReuseWork(scope.userId, pageId, eventId, source.objectId);
  const current = () => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
  const authority = async () => { current(); await getPageEventSaveState(pageId, eventId, scope); current(); };
  try {
    await authority();
    if (!unprepared) {
      const attempts = await readPageEventMediaAttempts(pageId, eventId, scope); current();
      const candidates = attempts.filter(a => a.pageId === pageId && a.eventId === eventId && a.userId === scope.userId
        && a.purpose === source.purpose && a.mimeType === source.mimeType && a.byteSize === source.byteSize);
      const fingerprints = new Set<string>();
      const etag = source.etag.match(/^"([a-f\d]{32})"$/i);
      if (etag) fingerprints.add(etag[1].toLowerCase());
      const extension = source.mimeType === 'video/mp4' ? 'mp4' : source.mimeType === 'image/jpeg' ? 'jpg' : source.mimeType === 'image/png' ? 'png' : 'webp';
      for (const folder of folders) {
        const file = await FileSystem.getInfoAsync(folder + 'source.' + extension, {md5: true}); current();
        if (file.exists && !file.isDirectory && file.size === source.byteSize && typeof file.md5 === 'string' && /^[a-f\d]{32}$/i.test(file.md5)) {
          if (etag && file.md5.toLowerCase() !== etag[1].toLowerCase()) throw Error('The recorded import file changed. Keep it for review.');
          fingerprints.add(file.md5.toLowerCase());
        }
      }
      const matches = candidates.filter(a => fingerprints.has(a.fileMd5.toLowerCase()));
      if (matches.length > 1 || candidates.length && matches.length !== 1) throw Error('The original upload association is uncertain. Keep its files for review.');
      if (matches.length === 1) {
        const original = matches[0];
        await verifyPageEventMediaFile(original, scope); current();
        // Persist association before any remote abandon/terminal file cleanup.
        await onOriginal(original); current();
        return original;
      }
      // Import upload cannot dispatch until original preparation AND its parent
      // association are acknowledged. With this import's lease held and a
      // confirmed absent candidate, retain that negative result before deletion.
      await onUnprepared(); current();
    }
    for (const folder of folders) { await authority(); await FileSystem.deleteAsync(folder, {idempotent: true}); current(); }
    return null;
  } finally { release(); }
}
