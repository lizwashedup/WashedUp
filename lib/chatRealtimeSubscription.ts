/** The Realtime SDK ignores connect() while its last socket is closing.
 * Own the delayed join so leaving a room cannot subscribe it afterward. */
export function subscribeChatWhenReady(
  isDisconnecting: () => boolean,
  subscribe: () => void,
  isCurrent: () => boolean,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (!active || !isCurrent()) return;
    if (isDisconnecting()) { timer = setTimeout(start, 50); return; }
    subscribe();
  };
  start();
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}

let nextVisit = 0;
/** PostgreSQL subscriptions may use distinct names per visit. Broadcast and
 * presence channels must retain their shared room names instead. */
export function nextChatDataChannelName(room: string): string {
  return `${room}:visit:${++nextVisit}`;
}
