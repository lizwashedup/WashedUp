/**
 * Wishlist capture tests: the push_new_plans_area flip, idempotency (two taps
 * never duplicate anything), the pending-migration gate, and the
 * never-throw contract.
 */
import { saveAreaWishlistWithDeps, AreaWishlistDeps } from '../wishlist';

function mkDeps(overrides: Partial<AreaWishlistDeps> = {}): AreaWishlistDeps & {
  flagCalls: string[];
  rowCalls: string[];
} {
  const flagCalls: string[] = [];
  const rowCalls: string[] = [];
  return {
    flagCalls,
    rowCalls,
    async setPushNewPlansArea(userId) {
      flagCalls.push(userId);
      return { error: null };
    },
    async upsertDemandSignal(userId) {
      rowCalls.push(userId);
      return { error: null };
    },
    tableReady: true,
    ...overrides,
  };
}

describe('saveAreaWishlistWithDeps', () => {
  it('flips the flag and upserts the demand row when the table is ready', async () => {
    const deps = mkDeps();
    const result = await saveAreaWishlistWithDeps('user-1', deps);
    expect(result).toEqual({ ok: true, demandSignalPending: false });
    expect(deps.flagCalls).toEqual(['user-1']);
    expect(deps.rowCalls).toEqual(['user-1']);
  });

  it('is idempotent: a second tap re-runs the same upsert-shaped writes, never an insert', async () => {
    const deps = mkDeps();
    await saveAreaWishlistWithDeps('user-1', deps);
    await saveAreaWishlistWithDeps('user-1', deps);
    // Both effects are keyed on user_id (boolean UPDATE + ON CONFLICT upsert),
    // so N taps converge on one row and one flag value.
    expect(deps.flagCalls).toEqual(['user-1', 'user-1']);
    expect(deps.rowCalls).toEqual(['user-1', 'user-1']);
  });

  it('skips the demand row while the migration is pending and reports it', async () => {
    const deps = mkDeps({ tableReady: false });
    const result = await saveAreaWishlistWithDeps('user-1', deps);
    expect(result).toEqual({ ok: true, demandSignalPending: true });
    expect(deps.flagCalls).toEqual(['user-1']);
    expect(deps.rowCalls).toEqual([]);
  });

  it('fails soft when the flag update errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = mkDeps({
      async setPushNewPlansArea() {
        return { error: { message: 'rls denied' } };
      },
    });
    const result = await saveAreaWishlistWithDeps('user-1', deps);
    expect(result.ok).toBe(false);
    expect(deps.rowCalls).toEqual([]);
    warn.mockRestore();
  });

  it('keeps ok=true when only the demand row fails (flag is the user-visible promise)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = mkDeps({
      async upsertDemandSignal() {
        return { error: { message: 'table missing' } };
      },
    });
    const result = await saveAreaWishlistWithDeps('user-1', deps);
    expect(result).toEqual({ ok: true, demandSignalPending: true });
    warn.mockRestore();
  });

  it('never throws, even when deps throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = mkDeps({
      async setPushNewPlansArea() {
        throw new Error('network down');
      },
    });
    await expect(saveAreaWishlistWithDeps('user-1', deps)).resolves.toMatchObject({ ok: false });
    warn.mockRestore();
  });

  it('rejects a missing user id without touching the database', async () => {
    const deps = mkDeps();
    const result = await saveAreaWishlistWithDeps('', deps);
    expect(result.ok).toBe(false);
    expect(deps.flagCalls).toEqual([]);
  });
});
