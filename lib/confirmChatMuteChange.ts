/** A timed-out write may have committed. Read the actual preference before
 * updating the UI; never compensate by writing its inverse. Callers must bind
 * read/write to the same account/room and discard stale screen completions. */
export async function confirmChatMuteChange(
  desired: boolean,
  write: (value: boolean) => Promise<void>,
  read: () => Promise<boolean>,
): Promise<{ value: boolean | null; matched: boolean }> {
  try { await write(desired); } catch { /* Readback resolves an uncertain write. */ }
  try {
    const value = await read();
    return typeof value === 'boolean'
      ? { value, matched: value === desired }
      : { value: null, matched: false };
  } catch {
    return { value: null, matched: false };
  }
}
