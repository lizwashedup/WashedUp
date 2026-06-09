/**
 * Cross-screen signal to refresh the Chats list out-of-band.
 *
 * The Chats list (useChatList) is not a react-query cache, and its focus
 * refetch is throttled (~30s) to avoid the rapid-tab-switch slowness. When a
 * brand-new conversation is created elsewhere (e.g. opening a DM via
 * get_or_create_dm), we set this flag so the Chats screen does a one-off
 * refetch on its next focus, bypassing the throttle, instead of the new DM
 * being invisible for up to 30s.
 */
let dirty = false;

export function markChatListDirty(): void {
  dirty = true;
}

/** Returns true (once) if a refresh was requested, then clears the flag. */
export function consumeChatListDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}
