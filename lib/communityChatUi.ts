import { formatEventDateLA, getLADayParts, getTodayInLA } from './laDate';

const MENTION_AT_CARET = /(?:^|\s)@([\p{L}\p{N}_]*)$/u;

export function mentionQueryAt(text: string, caret: number): string | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const match = text.slice(0, safeCaret).match(MENTION_AT_CARET);
  return match ? match[1] : null;
}

export function insertMentionAt(text: string, caret: number, firstName: string): { text: string; caret: number } {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const suffix = text.slice(safeCaret);
  const mention = suffix.startsWith(' ') ? `@${firstName}` : `@${firstName} `;
  const before = text.slice(0, safeCaret).replace(/@[\p{L}\p{N}_]*$/u, mention);
  return { text: before + suffix, caret: before.length };
}

export function isSameChatDay(a: string, b: string): boolean {
  const left = getLADayParts(a);
  const right = getLADayParts(b);
  return left.y === right.y && left.m === right.m && left.d === right.d;
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
