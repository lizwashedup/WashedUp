jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { Linking } from 'react-native';
import { router } from 'expo-router';
import { internalRouteFor, openUrl, soleUrlIn } from '../url';

const PLAN_ID = 'fe50d58b-0071-4818-bfbe-0b0e936650ea';

describe('internalRouteFor', () => {
  it('routes a shared short link to the native landing screen', () => {
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}`)).toBe(`/e/${PLAN_ID}`);
  });

  it('accepts the www host and http scheme', () => {
    expect(internalRouteFor(`http://www.washedup.app/e/${PLAN_ID}`)).toBe(`/e/${PLAN_ID}`);
  });

  it('keeps the query string but drops a fragment (S-05: params must survive)', () => {
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}?utm_source=chat`)).toBe(`/e/${PLAN_ID}?utm_source=chat`);
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}#top`)).toBe(`/e/${PLAN_ID}`);
  });

  it('strips sentence punctuation from the end of a query too', () => {
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}?task=checkin.`)).toBe(`/e/${PLAN_ID}?task=checkin`);
  });

  it('routes a referral link to the native landing screen', () => {
    expect(internalRouteFor('https://washedup.app/r/abc123')).toBe('/r/abc123');
  });

  it('tolerates a trailing slash', () => {
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}/`)).toBe(`/e/${PLAN_ID}`);
  });

  it('strips sentence punctuation the linkifier swept into the URL', () => {
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}.`)).toBe(`/e/${PLAN_ID}`);
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID})`)).toBe(`/e/${PLAN_ID}`);
  });

  it('routes a plan slug and decodes percent escapes', () => {
    expect(internalRouteFor('https://washedup.app/plans/washedup-wurstk%C3%BCche'))
      .toBe('/plans/washedup-wurstküche');
  });

  it('leaves paths with no native route alone', () => {
    expect(internalRouteFor('https://washedup.app')).toBeNull();
    expect(internalRouteFor('https://washedup.app/support')).toBeNull();
    expect(internalRouteFor(`https://washedup.app/e/${PLAN_ID}/extra`)).toBeNull();
  });

  it('never claims another domain', () => {
    expect(internalRouteFor('https://example.com/e/abc')).toBeNull();
    expect(internalRouteFor('https://notwashedup.app/e/abc')).toBeNull();
    expect(internalRouteFor('https://washedup.app.evil.com/e/abc')).toBeNull();
  });
});

describe('soleUrlIn', () => {
  it('finds the one link in a message that has prose around it', () => {
    const text = `Alright, here's the new event. Looking forward to meeting y'all!\n\nHospital of Emotions (new date)\nhttps://washedup.app/e/${PLAN_ID}`;
    expect(soleUrlIn(text)).toBe(`https://washedup.app/e/${PLAN_ID}`);
  });

  it('returns null when the message has no link', () => {
    expect(soleUrlIn('Mondays or Fridays would work best for me')).toBeNull();
    expect(soleUrlIn('')).toBeNull();
    expect(soleUrlIn(null)).toBeNull();
    expect(soleUrlIn(undefined)).toBeNull();
  });

  it('returns null when the message has more than one link, so the bubble is never ambiguous', () => {
    expect(soleUrlIn('https://washedup.app/e/a and https://example.com/b')).toBeNull();
  });

  it('counts a bare www link', () => {
    expect(soleUrlIn('see www.example.com for details')).toBe('www.example.com');
  });
});

describe('openUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  });

  it('routes our own link in app instead of handing it to the OS', () => {
    openUrl(`https://washedup.app/e/${PLAN_ID}`);
    expect(router.push).toHaveBeenCalledWith(`/e/${PLAN_ID}`);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('still sends an external link to the OS', () => {
    openUrl('https://stripe.com/checkout/abc');
    expect(Linking.openURL).toHaveBeenCalledWith('https://stripe.com/checkout/abc');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('adds the missing protocol on a bare www link', () => {
    openUrl('www.example.com');
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.example.com');
  });
});
