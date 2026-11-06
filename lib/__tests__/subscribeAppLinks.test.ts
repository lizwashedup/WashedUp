import { subscribeAppLinks } from '../subscribeAppLinks';

function fixture() {
  let resolve!: (url: string | null) => void;
  let reject!: (error: unknown) => void;
  const initial = new Promise<string | null>((yes, no) => { resolve = yes; reject = no; });
  let listener!: (event: { url: string }) => void;
  const remove = jest.fn(), onUrl = jest.fn(), onError = jest.fn();
  const source = { getInitialURL: () => initial, addEventListener: (_event: 'url', callback: typeof listener) => {
    listener = callback; return { remove };
  } };
  const stop = subscribeAppLinks(source, onUrl, onError);
  return { resolve, reject, remove, onUrl, onError, stop, send: (url: string) => listener({ url }) };
}
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

it('preserves every current foreground event without deduplicating intentional repeated taps', async () => {
  const f = fixture(); f.resolve(null); await flush();
  const url = 'washedupapp://app/plan/local?invitation=kept';
  f.send(url); f.send(url);
  expect(f.onUrl.mock.calls).toEqual([[url], [url]]); f.stop();
});
it('does not let an empty event erase the initial delivery', async () => {
  const f = fixture(); f.send(''); f.resolve('https://washedup.app/r/local-code'); await flush();
  expect(f.onUrl).toHaveBeenCalledWith('https://washedup.app/r/local-code'); f.stop();
});
it('preserves recovery fragments without inspecting or logging credentials', async () => {
  const f = fixture(); const url = 'https://washedup.app/auth/callback#type=recovery&access_token=fictional';
  f.resolve(url); await flush(); expect(f.onUrl).toHaveBeenCalledWith(url); expect(f.onError).not.toHaveBeenCalled(); f.stop();
});
it.each(['unmount', 'foreground'] as const)('suppresses an obsolete initial failure after %s', async change => {
  const f = fixture(); if (change === 'unmount') f.stop(); else f.send('https://washedup.app/plans/local');
  f.reject(Error('initial read unavailable')); await flush(); expect(f.onError).not.toHaveBeenCalled();
  if (change === 'foreground') f.stop();
});
it('reports a current initial read failure and still accepts a later foreground link', async () => {
  const f = fixture(); const error = Error('initial read unavailable'); f.reject(error); await flush();
  expect(f.onError).toHaveBeenCalledWith(error); f.send('https://washedup.app/plans/local');
  expect(f.onUrl).toHaveBeenCalledWith('https://washedup.app/plans/local'); f.stop();
});
