export interface PaidTicketSetupHandoff {
  pendingAutosave: Promise<void> | null;
  saveEvent: () => Promise<void>;
  syncEventState: () => Promise<void>;
  invalidateTicketEvent: () => Promise<void>;
  navigate: () => void;
}

/**
 * Drain an older background save, persist the current event last, then refresh
 * the ticket query before navigation. This prevents stale autosave completion
 * from erasing a newly selected end time.
 */
export async function runPaidTicketSetupHandoff({
  pendingAutosave,
  saveEvent,
  syncEventState,
  invalidateTicketEvent,
  navigate,
}: PaidTicketSetupHandoff): Promise<void> {
  if (pendingAutosave) {
    try {
      await pendingAutosave;
    } catch {
      // The explicit full save below is authoritative and reports its own error.
    }
  }
  await saveEvent();
  await syncEventState();
  await invalidateTicketEvent();
  navigate();
}
