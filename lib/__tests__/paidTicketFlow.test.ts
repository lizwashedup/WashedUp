import { runPaidTicketSetupHandoff } from '../paidTicketFlow';

describe('runPaidTicketSetupHandoff', () => {
  it('waits for a stale autosave, then writes the current event before navigation', async () => {
    const order: string[] = [];
    let finishAutosave!: () => void;
    const pendingAutosave = new Promise<void>((resolve) => {
      finishAutosave = () => {
        order.push('old autosave finished');
        resolve();
      };
    });

    const handoff = runPaidTicketSetupHandoff({
      pendingAutosave,
      saveEvent: async () => { order.push('current event saved'); },
      syncEventState: async () => { order.push('event state synced'); },
      invalidateTicketEvent: async () => { order.push('ticket event refreshed'); },
      navigate: () => { order.push('ticket screen opened'); },
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    finishAutosave();
    await handoff;
    expect(order).toEqual([
      'old autosave finished',
      'current event saved',
      'event state synced',
      'ticket event refreshed',
      'ticket screen opened',
    ]);
  });

  it('still performs the authoritative save after a background save fails', async () => {
    const saveEvent = jest.fn(async () => undefined);
    await expect(runPaidTicketSetupHandoff({
      pendingAutosave: Promise.reject(new Error('background failure')),
      saveEvent,
      syncEventState: async () => undefined,
      invalidateTicketEvent: async () => undefined,
      navigate: () => undefined,
    })).resolves.toBeUndefined();
    expect(saveEvent).toHaveBeenCalledTimes(1);
  });
});
