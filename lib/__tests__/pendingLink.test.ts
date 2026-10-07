import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingCheckout,
  clearPendingDestination,
  consumePendingDestination,
  parseAppDestination,
  pendingCheckoutForEvent,
  peekPendingCheckout,
  stashPendingCheckout,
  stashPendingDestination,
} from '../pendingLink';
import { redirectSystemPath } from '../../app/+native-intent';

const ID = 'fe50d58b-0071-4818-bfbe-0b0e936650ea';

describe('parseAppDestination', () => {
  it('maps the claimed shapes to their in-app routes', () => {
    expect(parseAppDestination(`https://washedup.app/e/${ID}`)).toBe(`/e/${ID}`);
    expect(parseAppDestination('https://washedup.app/plans/some-slug')).toBe('/plans/some-slug');
    expect(parseAppDestination(`https://washedup.app/app/plan/${ID}`)).toBe(`/plan/${ID}`);
    expect(parseAppDestination(`https://washedup.app/app/event/${ID}`)).toBe(`/event/${ID}`);
    expect(parseAppDestination(`washedupapp://e/${ID}`)).toBe(`/e/${ID}`);
  });

  it('keeps the query string on the stashed destination (S-05)', () => {
    expect(parseAppDestination(`https://washedup.app/e/${ID}?task=checkin&filter=tonight`))
      .toBe(`/e/${ID}?task=checkin&filter=tonight`);
    expect(parseAppDestination(`https://washedup.app/app/plan/${ID}?return_route=chat`))
      .toBe(`/plan/${ID}?return_route=chat`);
  });

  it('drops the fragment and rejects foreign or unroutable links', () => {
    expect(parseAppDestination(`https://washedup.app/e/${ID}#top`)).toBe(`/e/${ID}`);
    expect(parseAppDestination('https://example.com/e/abc')).toBeNull();
    expect(parseAppDestination('https://washedup.app/support')).toBeNull();
    expect(parseAppDestination('')).toBeNull();
  });
});

describe('redirectSystemPath (universal-link routing)', () => {
  const call = (path: string) => redirectSystemPath({ path, initial: false });

  it('routes native shapes with their query preserved', () => {
    expect(call(`https://washedup.app/e/${ID}?task=checkin`)).toBe(`/e/${ID}?task=checkin`);
    expect(call('https://washedup.app/plans/some-slug')).toBe('/plans/some-slug');
    expect(call('https://washedup.app/r/abc123')).toBe('/r/abc123');
  });

  it('keeps the creator app-door guarantee', () => {
    expect(call('https://washedup.app/app/creator/events')).toBe('/(creator)/events');
  });

  it('routes a Stripe success return into the native checkout handoff', () => {
    expect(call(`https://washedup.app/e/?checkout=success&session_id=cs_live_123&order=${ID}&native=1`))
      .toBe(`/checkout-return?checkout=success&session_id=cs_live_123&order=${ID}&native=1`);
  });

  it('routes a Stripe cancellation into the native checkout handoff', () => {
    expect(call(`https://washedup.app/e/?checkout=cancelled&order=${ID}&native=1`))
      .toBe(`/checkout-return?checkout=cancelled&order=${ID}&native=1`);
  });

  it('routes Stripe payout returns into the native payouts screen', () => {
    expect(call('https://washedup.app/creator/payouts/return')).toBe('/creator/payouts?stripe=return');
    expect(call('https://washedup.app/creator/payouts/refresh')).toBe('/creator/payouts?stripe=refresh');
    expect(call('https://washedup.app/app/creator/payouts?stripe=return')).toBe('/creator/payouts?stripe=return');
  });

  it('maps web app-shell object links to their native screens', () => {
    expect(call(`https://washedup.app/app/plan/${ID}`)).toBe(`/plan/${ID}`);
    expect(call(`https://washedup.app/app/event/${ID}?return_route=chat`)).toBe(`/event/${ID}?return_route=chat`);
  });

  it('passes password-recovery callbacks through untouched', () => {
    const recovery = 'https://washedup.app/auth/callback#access_token=a&refresh_token=b&type=recovery';
    expect(call(recovery)).toBe(recovery);
  });

  it('sends web-only paths to the in-app-browser fallback instead of a dead not-found', () => {
    const out = call('https://washedup.app/c/some-house?manage=membership');
    expect(out).toBe(`/web-fallback?url=${encodeURIComponent('https://washedup.app/c/some-house?manage=membership')}`);
  });

  it('leaves custom-scheme and foreign paths alone', () => {
    expect(call('/plan/abc')).toBe('/plan/abc');
    expect(call('https://example.com/whatever')).toBe('https://example.com/whatever');
  });
});

describe('pending destination durability', () => {
  const href = `/e/${ID}`;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('consumes a saved destination once when no guard is supplied', async () => {
    await stashPendingDestination(href);

    await expect(consumePendingDestination()).resolves.toBe(href);
    await expect(consumePendingDestination()).resolves.toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
  });

  it.each(['signout', 'same-user signout/signin'])(
    'retains the durable destination when %s invalidates a pending read',
    async (transition) => {
      await stashPendingDestination(href);
      let activeUserId: string | null = 'user-a';
      let generation = 0;
      const startingGeneration = generation;
      const shouldConsume = jest.fn(() => (
        activeUserId === 'user-a' && generation === startingGeneration
      ));
      let finishRead!: (value: string | null) => void;
      jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((resolve) => {
        finishRead = resolve;
      }));

      const consumption = consumePendingDestination(shouldConsume);
      expect(shouldConsume).not.toHaveBeenCalled();
      activeUserId = null;
      generation += 1;
      if (transition === 'same-user signout/signin') {
        activeUserId = 'user-a';
        generation += 1;
      }
      finishRead(href);

      await expect(consumption).resolves.toBeNull();
      expect(shouldConsume).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
      await expect(consumePendingDestination(() => true)).resolves.toBe(href);
      await expect(consumePendingDestination()).resolves.toBeNull();
    },
  );

  it('clears only when the optional guard allows the mutation', async () => {
    await stashPendingDestination(href);
    await clearPendingDestination(() => false);

    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    await expect(consumePendingDestination()).resolves.toBe(href);
    await stashPendingDestination(href);
    await clearPendingDestination(() => true);
    await expect(consumePendingDestination()).resolves.toBeNull();
    await stashPendingDestination(href);
    await clearPendingDestination();
    await expect(consumePendingDestination()).resolves.toBeNull();
  });

  it('treats storage read and removal failures as best-effort', async () => {
    await stashPendingDestination(href);
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failed'));

    await expect(consumePendingDestination()).resolves.toBeNull();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('remove failed'));
    await expect(consumePendingDestination()).resolves.toBeNull();
    await expect(consumePendingDestination()).resolves.toBe(href);
  });

  it('treats storage stash and clear failures as best-effort', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('write failed'));
    await expect(stashPendingDestination(href)).resolves.toBeUndefined();

    await stashPendingDestination(href);
    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('remove failed'));
    await expect(clearPendingDestination()).resolves.toBeUndefined();
    await expect(consumePendingDestination()).resolves.toBe(href);
  });
});

describe('pending checkout durability', () => {
  beforeEach(async () => AsyncStorage.clear());

  it('survives repeated foreground reads until the order screen clears it', async () => {
    await stashPendingCheckout(ID);
    expect(await peekPendingCheckout()).toBe(ID);
    expect(await peekPendingCheckout()).toBe(ID);
    await clearPendingCheckout();
    expect(await peekPendingCheckout()).toBeNull();
  });

  it('opens the saved order for the same event instead of restarting Stripe', async () => {
    await stashPendingCheckout(ID);
    const loadOrder = jest.fn(async () => ({ event_id: 'event-a' }));

    expect(await pendingCheckoutForEvent('event-a', loadOrder)).toBe(ID);
    expect(loadOrder).toHaveBeenCalledWith(ID);
    expect(await peekPendingCheckout()).toBe(ID);
  });

  it('does not redirect a different event to the saved order', async () => {
    await stashPendingCheckout(ID);
    expect(await pendingCheckoutForEvent('event-b', async () => ({ event_id: 'event-a' }))).toBeNull();
  });
});


describe('pending checkout exact cleanup',()=>{
 beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();});
 it('does not clear a newer checkout when an old order screen finishes',async()=>{
  await stashPendingCheckout('new-order');await clearPendingCheckout('old-order');expect(await peekPendingCheckout()).toBe('new-order');
  await clearPendingCheckout('new-order');expect(await peekPendingCheckout()).toBeNull();
 });
 it('does not clear after the initiating visit retires',async()=>{
  await stashPendingCheckout(ID);await clearPendingCheckout(ID,()=>false);expect(await peekPendingCheckout()).toBe(ID);
 });
 it('strict reads distinguish storage failure from an absent pointer',async()=>{
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('offline'));await expect(peekPendingCheckout(true)).rejects.toThrow('offline');
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('offline'));await expect(peekPendingCheckout()).resolves.toBeNull();
 });
 it('serializes a new handoff behind an in-flight exact removal',async()=>{
  await stashPendingCheckout(ID);let resolve!:(v:string)=>void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const clearing=clearPendingCheckout(ID);await Promise.resolve();
  const saving=stashPendingCheckout('new-order');resolve(ID);await Promise.all([clearing,saving]);
  expect(await peekPendingCheckout()).toBe('new-order');
 });
});
