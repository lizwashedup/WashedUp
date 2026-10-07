/** The outer UI guard must leave room for identity (8s), insert (12s)
 * and lost-response lookup (8s), rather than retiring recovery at 12s. */
export const CHAT_SEND_ATTEMPT_DEADLINE_MS = 35_000;

export interface ChatSendReceipt { id: string; created_at: string }
type ReadResult = { data: ChatSendReceipt | null; error: unknown };

/** A lost insert response is not proof a chat message failed. Check its UUID. */
export async function resolveChatSendReceipt(
  insert: () => Promise<ReadResult>,
  lookup: () => Promise<ReadResult>,
): Promise<{ receipt: ChatSendReceipt | null; failure: unknown }> {
  let failure: unknown = null;
  try {
    const result = await insert();
    if (!result.error && result.data) return { receipt: result.data, failure: null };
    failure = result.error ?? new Error('No send confirmation');
  } catch (error) {
    failure = error;
  }
  try {
    const result = await lookup();
    if (!result.error && result.data) return { receipt: result.data, failure: null };
    if (!failure) failure = result.error;
  } catch (error) {
    if (!failure) failure = error;
  }
  return { receipt: null, failure };
}
