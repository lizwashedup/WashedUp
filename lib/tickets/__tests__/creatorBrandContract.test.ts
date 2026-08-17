import { parseCreatorBrand, resolveCreatorBrand } from '../creatorBrandContract';

const creator = {
  displayName: 'Community One',
  logoUrl: 'https://assets.example.com/community-one.png',
  accentColor: '#123ABC',
};
const creatorDefault = {
  displayName: 'Creator Default',
  logoUrl: null,
  accentColor: '#654321',
};

describe('creator brand data contract', () => {
  it('preserves valid creator-supplied brand fields', () => {
    const resolved = resolveCreatorBrand(creator, creatorDefault);
    expect(resolved).toEqual({
      ...creator,
      source: 'activity',
      snapshotVersion: 1,
      snapshotKey: 'v1:Community%20One:https%3A%2F%2Fassets.example.com%2Fcommunity-one.png:#123ABC',
    });
  });

  it('uses only the supplied creator default when activity data is invalid', () => {
    expect(resolveCreatorBrand({ ...creator, accentColor: 'orange' }, creatorDefault)?.source)
      .toBe('creator_default');
  });

  it('fails closed when the creator default is invalid', () => {
    expect(resolveCreatorBrand(creator, { ...creatorDefault, accentColor: 'invalid' })).toBeNull();
  });

  it('rejects insecure logo URLs and unknown fields', () => {
    expect(parseCreatorBrand({ ...creator, logoUrl: 'http://assets.example.com/logo.png' })).toBeNull();
    expect(parseCreatorBrand({ ...creator, extra: true })).toBeNull();
  });

  it('accepts lowercase hex and stores one canonical representation', () => {
    expect(parseCreatorBrand({ ...creator, accentColor: '#aabbcc' })?.accentColor).toBe('#AABBCC');
  });

  it('produces stable keys for equal snapshots', () => {
    expect(resolveCreatorBrand(creator, creatorDefault)?.snapshotKey).toBe(
      resolveCreatorBrand({ ...creator }, { ...creatorDefault })?.snapshotKey,
    );
  });
});
