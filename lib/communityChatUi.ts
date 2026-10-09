import { formatEventDateLA, getLADayParts, getTodayInLA } from './laDate';

const MENTION_AT_CARET = /(?:^|[\s([{])@([\p{L}\p{M}\p{N}_'’\-]*)$/u;
// Grouping is fixed to LA, so the formatter can survive device-zone changes.
// Reuse it across visible rows; keep relative today/yesterday labels live below.
let chatDayFormatter: Intl.DateTimeFormat | undefined;

export function mentionQueryAt(text: string, caret: number): string | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const match = text.slice(0, safeCaret).match(MENTION_AT_CARET);
  return match ? match[1] : null;
}

export function insertMentionAt(text: string, caret: number, firstName: string): { text: string; caret: number } {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  if (mentionQueryAt(text, safeCaret) === null) return { text, caret: safeCaret };
  // Replacing a query halfway through a token must not leave its old ending.
  const suffix = text.slice(safeCaret).replace(/^[\p{L}\p{M}\p{N}_'’\-]+/u, '');
  const mention = /^\s/u.test(suffix) ? `@${firstName}` : `@${firstName} `;
  const before = text.slice(0, safeCaret).replace(/@[\p{L}\p{M}\p{N}_'’\-]*$/u, mention);
  return { text: before + suffix, caret: before.length + (suffix.startsWith(' ') ? 1 : 0) };
}

export function isSameChatDay(a: string, b: string): boolean {
  chatDayFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
  });
  return chatDayFormatter.format(new Date(a)) === chatDayFormatter.format(new Date(b));
}

export function formatChatDay(iso: string): string {
  const day = getLADayParts(iso);
  const today = getTodayInLA();
  if (day.y === today.y && day.m === today.m && day.d === today.d) return 'today';
  const yesterday = new Date(Date.UTC(today.y, today.m, today.d) - 24 * 60 * 60 * 1000);
  if (day.y === yesterday.getUTCFullYear() && day.m === yesterday.getUTCMonth() && day.d === yesterday.getUTCDate()) {
    return 'yesterday';
  }
  return formatEventDateLA(iso).toLowerCase();
}

export function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
