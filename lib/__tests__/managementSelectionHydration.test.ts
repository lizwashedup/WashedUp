import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('react', () => ({ ...jest.requireActual('react'), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));

/** The late disk read must not replace the identity explicitly selected in Yours. */
it.each([
  ['../selectedCommunity', 'hydrateSelectedCommunity', 'setSelectedCommunityId', 'useSelectedCommunityId', 'old-community', 'chosen-community'],
  ['../workspaceContext', 'hydrateWorkspace', 'setWorkspace', 'useRawWorkspace', 'community', 'organization'],
])('keeps the current selection while %s hydrates', async (module, hydrate, select, snapshot, old, chosen) => {
  let finish!: (value: string) => void;
  const read = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let fresh: any;
  jest.isolateModules(() => { fresh = require(module); });
  const pending = fresh[hydrate]();
  fresh[select](chosen);
  finish(old); await pending;
  expect(fresh[snapshot]()).toBe(chosen);
  // With an explicit selection, subsequent hydration must not re-read stale disk state either.
  await fresh[hydrate](); expect(read).toHaveBeenCalledTimes(1);
  read.mockRestore();
});
