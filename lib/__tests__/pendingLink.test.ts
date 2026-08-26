import { parseAppDestination } from '../pendingLink';
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
