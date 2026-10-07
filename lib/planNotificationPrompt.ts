export type PlanNotificationPromptReason = 'posted' | 'joined';
export type PlanNotificationPromptRequest = Readonly<{
  userId: string;
  planId: string;
  reason: PlanNotificationPromptReason;
}>;

type Listener = (request: PlanNotificationPromptRequest) => void;
const listeners = new Set<Listener>();

/** Root owns the queue, account epoch, modal handoff and existing snooze.
 * This channel deliberately retains no request for a future account/launch. */
export function subscribePlanNotificationPrompts(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Call only at a confirmed post/join completion, after its local sheets close.
 * A notification invitation must never reject or roll back that completion. */
export function requestPlanNotificationPrompt(
  request: PlanNotificationPromptRequest,
  isCurrent: () => boolean,
): void {
  if (!request.userId?.trim() || !request.planId?.trim() || !isCurrent()) return;
  const snapshot = Object.freeze({ ...request });
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* A reminder cannot undo a saved plan. */ }
  }
}

export function planNotificationPromptCopy(reason: PlanNotificationPromptReason) {
  return {
    title: 'Know when people join',
    body: reason === 'joined'
      ? 'Turn on notifications to hear when others join and keep up with messages.'
      : 'Turn on notifications for updates when people join your plan or send a message.',
  };
}
