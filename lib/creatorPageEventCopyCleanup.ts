/** Exact terminal cleanup after a copy is stopped. Never removes attached media
 * or forgets a missing/denied original reservation or unfinished import. */
import type {SavedPageEventReuse} from './creatorPageEventReuse';
import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {readPageEventMediaReuseAttempts, clearPageEventMediaReuseAttempt} from './creatorPageEventMediaReuseAttempt';
import {getPageEventMediaReuseAttempt, cancelPageEventMediaReuse, pageEventMediaReuseInput} from './creatorPageEventMediaReuse';
import {getPageEventMediaAttempt, reservePageEventMedia, abandonPageEventMedia} from './creatorPageEventMedia';
import {recoverStoppedLegacyEventMedia} from './legacyEventMediaRecovery';
import {clearLegacyEventMediaImport} from './legacyEventMediaImport';

export async function cleanupStoppedPageEventCopy(a: SavedPageEventReuse, scope: CreatorPageScope, action: 'check' | 'keep', persist?: () => Promise<void>) {
  const current = () => { if (!scope.isCurrent() || scope.userId !== a.userId) throw new CreatorPageScopeExpired(); };
  current();
  const copies = await readPageEventMediaReuseAttempts(a.pageId, a.eventId, scope); current();
  for (const copy of copies) {
    if (!a.plan.media.some(slot => slot.purpose === copy.purpose && slot.sourceMediaId === copy.source.mediaId
      && a.source.pageId === copy.source.pageId && a.source.eventId === copy.source.eventId)) continue;
    let receipt = await getPageEventMediaReuseAttempt(a.pageId, a.eventId, copy, scope); current();
    if (!receipt && action === 'keep') { receipt = await cancelPageEventMediaReuse(a.pageId, a.eventId, copy, scope); current(); }
    if (!receipt) throw Error('The original media reservation still needs checking.');
    if (!receipt.attached && !receipt.abandonedAt) {
      if (action !== 'keep') throw Error('Finish the original copy cleanup.');
      await abandonPageEventMedia(a.pageId, a.eventId, pageEventMediaReuseInput(copy), scope); current();
    }
    await clearPageEventMediaReuseAttempt(copy, scope); current();
  }
  for (const legacy of a.legacyImports ?? []) {
    if (!legacy.original) {
      if (!legacy.downloads.length) continue;
      if (!persist) throw Error('The original import files still need recovery.');
      const recovered = await recoverStoppedLegacyEventMedia({pageId: a.pageId, eventId: a.eventId,
        source: legacy.source, downloads: legacy.downloads, unprepared: legacy.unprepared,
        onOriginal: async original => { legacy.original = JSON.parse(JSON.stringify(original)); await persist(); },
        onUnprepared: async () => { legacy.unprepared = true; await persist(); }}, scope); current();
      if (!recovered) continue;
    }
    let receipt = await getPageEventMediaAttempt(a.pageId, a.eventId, legacy.original!, scope); current();
    if (!receipt && action === 'keep') { receipt = await reservePageEventMedia(a.pageId, a.eventId, legacy.original!, scope); current(); }
    if (!receipt) throw Error('The original imported media still needs checking.');
    if (!receipt.attached && !receipt.abandonedAt) {
      if (action !== 'keep') throw Error('Finish the original import cleanup.');
      await abandonPageEventMedia(a.pageId, a.eventId, legacy.original!, scope); current();
    }
    await clearLegacyEventMediaImport(a.pageId, a.eventId, legacy.source, legacy.original!, legacy.downloads, scope); current();
  }
}
