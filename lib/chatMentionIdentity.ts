/** Offsets count Unicode code points, not UTF-16 units, so the same ranges
 * can be validated by PostgreSQL char_length/substring without splitting emoji. */
export interface ChatMentionReference {
  userId: string;
  label: string;
  start: number;
  end: number;
}
export interface ChatMentionDocument {
  version: 1;
  text: string;
  references: ChatMentionReference[];
}
export interface IdentityTextSegment { text: string; userId?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy drafts have no identity metadata. Present metadata must always be
 * bound to the exact saved body, including whitespace. */
export function validOptionalMentionDocument(text: string, value: unknown): boolean {
  return value == null || readChatMentionDocument(text, value) !== null;
}

/** Sending trims both ends at once. A generic text diff would drop references
 * between those two edits, so apply the known leading offset directly. */
export function trimChatMentionDocument(text: string, value: ChatMentionDocument): ChatMentionDocument {
  const data = readChatMentionDocument(text, value);
  if (!data) throw Error('Your saved mentions could not be read.');
  const trimmed = text.trim();
  const removed = Array.from(text.slice(0, text.length - text.trimStart().length)).length;
  const result: ChatMentionDocument = { version: 1, text: trimmed,
    references: data.references.map(ref => ({ ...ref, start: ref.start - removed, end: ref.end - removed })) };
  if (!readChatMentionDocument(trimmed, result)) throw Error('Your saved mentions could not be read.');
  return result;
}

/** A text-identical draft can still refer to a different person. */
export function sameChatMentionIdentity(text: string, left: unknown, right: unknown): boolean {
  if (!validOptionalMentionDocument(text, left) || !validOptionalMentionDocument(text, right)) return false;
  const normalized = (value: unknown) => (readChatMentionDocument(text, value)?.references ?? [])
    .map(ref => [ref.userId.toLowerCase(), ref.label, ref.start, ref.end]);
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

/** Invalid or stale metadata never produces a clickable person reference. */
export function readChatMentionDocument(text: string, value: unknown): ChatMentionDocument | null {
  const data = value as Partial<ChatMentionDocument> | null;
  if (!data || data.version !== 1 || data.text !== text || !Array.isArray(data.references)
    || data.references.length > 128) return null;
  const points = Array.from(text);
  let previousEnd = 0;
  for (const ref of data.references) {
    if (!ref || typeof ref.userId !== 'string' || !UUID.test(ref.userId)
      || typeof ref.label !== 'string' || !ref.label.trim() || Array.from(ref.label).length > 100
      || !Number.isInteger(ref.start) || !Number.isInteger(ref.end)
      || ref.start < previousEnd || ref.end <= ref.start || ref.end > points.length
      || points.slice(ref.start, ref.end).join('') !== `@${ref.label}`) return null;
    // Keep URL/email text out of the identity reference path.
    const before = points.slice(0, ref.start).join('');
    if (before && !/[\s([{]$/u.test(before)) return null;
    if (/(?:https?:\/\/|www\.)/iu.test(before.match(/\S+$/u)?.[0] ?? '')) return null;
    if (/[\p{L}\p{M}\p{N}_'’\-]/u.test(points[ref.end] ?? '')) return null;
    previousEnd = ref.end;
  }
  return data as ChatMentionDocument;
}

export function splitIdentityMentions(text: string, value: unknown): IdentityTextSegment[] {
  const data = readChatMentionDocument(text, value);
  if (!data?.references.length) return [{ text }];
  const points = Array.from(text), result: IdentityTextSegment[] = [];
  let start = 0;
  for (const ref of data.references) {
    if (ref.start > start) result.push({ text: points.slice(start, ref.start).join('') });
    result.push({ text: points.slice(ref.start, ref.end).join(''), userId: ref.userId });
    start = ref.end;
  }
  if (start < points.length) result.push({ text: points.slice(start).join('') });
  return result;
}

/** Preserve untouched references through one text edit; editing the tag itself
 * removes its identity until a member is explicitly chosen again. */
export function rebaseChatMentions(previous: ChatMentionDocument | null, nextText: string): ChatMentionDocument {
  const empty: ChatMentionDocument = { version: 1, text: nextText, references: [] };
  if (!previous || !readChatMentionDocument(previous.text, previous)) return empty;
  const before = Array.from(previous.text), after = Array.from(nextText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const removedEnd = before.length - suffix, delta = after.length - before.length;
  const touchedLabels = new Set(previous.references.filter(ref => ref.end > prefix && ref.start < removedEnd).map(ref => ref.label));
  const references = previous.references.flatMap(ref => {
    // A plain-text diff cannot know which identical name was deleted. Drop
    // ambiguous identities instead of silently assigning the remaining name
    // to the wrong person; an explicit picker choice can restore the tag.
    if (touchedLabels.has(ref.label)) return [];
    if (ref.end <= prefix) return [{ ...ref }];
    if (ref.start >= removedEnd) return [{ ...ref, start: ref.start + delta, end: ref.end + delta }];
    return [];
  }).filter(ref => readChatMentionDocument(nextText, { ...empty, references: [ref] }));
  return { ...empty, references };
}

/** Called only after an explicit current-room picker choice. Membership is
 * revalidated by the server before writing; a display name is never an ID. */
export function addChatMentionReference(text: string, existing: ChatMentionDocument | null,
  userId: string, label: string, startUtf16: number): ChatMentionDocument {
  const document = rebaseChatMentions(existing, text);
  if (!Number.isInteger(startUtf16) || startUtf16 < 0 || startUtf16 > text.length) throw Error('Invalid mention position');
  if (startUtf16 > 0 && /[\uD800-\uDBFF]/.test(text[startUtf16-1]) && /[\uDC00-\uDFFF]/.test(text[startUtf16] ?? '')) throw Error('Invalid mention position');
  const start = Array.from(text.slice(0, startUtf16)).length;
  const reference = { userId, label, start, end: start + Array.from(`@${label}`).length };
  const result = { ...document, references: [...document.references.filter(ref => ref.end <= reference.start || ref.start >= reference.end), reference].sort((a,b)=>a.start-b.start) };
  if (!readChatMentionDocument(text, result)) throw Error('Invalid mention reference');
  return result;
}
