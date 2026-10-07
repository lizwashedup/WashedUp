export interface MentionMember { id: string; first_name: string | null; avatar_url?: string | null }
export interface MentionSegment { text: string; mention: boolean }

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Only the supplied room membership is eligible; never search public handles. */
export function findMentionMembers<T extends MentionMember>(members: readonly T[], query: string | null, viewerId: string | null | undefined): T[] {
  if (query === null) return [];
  const needle = fold(query);
  return members.filter(member => member.id !== viewerId && !!member.first_name?.trim()
    && (!needle || fold(member.first_name).split(/\s+/u).some(part => part.startsWith(needle))));
}

const matchers = new WeakMap<ReadonlySet<string>, RegExp | null>();
function matcherFor(names: ReadonlySet<string>): RegExp | null {
  if (matchers.has(names)) return matchers.get(names)!;
  const escaped = [...names].filter(name => !!name.trim()).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = escaped.length ? new RegExp(`(^|[\\s([{])(@(?:${escaped.join('|')}))(?![\\p{L}\\p{M}\\p{N}_'’\\-])`, 'giu') : null;
  matchers.set(names, matcher);
  return matcher;
}

/** Names may contain spaces, accents, apostrophes or hyphens. URL segments
 * are excluded by the caller, so a link/email never becomes a person tag. */
export function splitChatMentions(text: string, names?: ReadonlySet<string>): MentionSegment[] {
  const matcher = names && matcherFor(names);
  if (!matcher) return [{ text, mention: false }];
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index! + match[1].length;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), mention: false });
    segments.push({ text: match[2], mention: true });
    cursor = start + match[2].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false });
  return segments.length ? segments : [{ text, mention: false }];
}
