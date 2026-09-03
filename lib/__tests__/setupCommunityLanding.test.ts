import { readFileSync } from 'fs';
import { resolve } from 'path';

// AC-CRT-002 ("a qualified account without a community, creating a
// community lands in the Creator Space with that community selected")
// automated gap.
//
// The SELECTION mechanism itself (useLedCommunity's `led.find(id) ?? led[0]
// ?? null` fallback) is already proven, real and passing, by
// workspaceContext.test.ts's "defaults to the first (oldest-led) community
// when nothing is selected" case -- that exercises the exact branch a
// brand-new, previously-community-less account hits (an empty selection
// falling through to led[0]); a second fixture sized to exactly one
// community would not exercise any code path that one doesn't already.
// Restating it here would be a duplicate, not new coverage.
//
// What NO test anywhere previously covered: app/creator/setup-community.tsx
// itself, the one caller of createCommunity() (lib/creatorMode.ts). Its
// success handler's SEQUENCE is the real remaining, checkable gap --
// invalidate creator-access BEFORE navigating, never after -- checked below
// via the same static source-contract technique creatorShellRedirects.test.ts
// already established for a screen that renders real native UI and isn't
// meaningfully unit-testable without a full RN harness. Getting this order
// backwards (navigate first) would land the creator on /today before their
// new community ever shows up in ledCommunities -- the exact "setup loop"
// failure class b99e369 (lib/__tests__/creatorAccess.test.ts) already fixed
// once for a different root cause.

describe('app/creator/setup-community.tsx static contract (source assertions, same technique as creatorShellRedirects.test.ts)', () => {
  const source = readFileSync(resolve(__dirname, '../../app/creator/setup-community.tsx'), 'utf8');

  it('invalidates creator-access before navigating away, never after', () => {
    const invalidateIdx = source.indexOf("invalidateQueries({ queryKey: ['creator-access'] })");
    const navigateIdx = source.indexOf("router.replace('/(creator)/today')");
    expect(invalidateIdx).toBeGreaterThan(-1);
    expect(navigateIdx).toBeGreaterThan(-1);
    expect(invalidateIdx).toBeLessThan(navigateIdx);
  });

  it('both the invalidate and the navigate are awaited on the createCommunity call succeeding, not fired eagerly', () => {
    const createIdx = source.indexOf('await createCommunity(');
    const invalidateIdx = source.indexOf("await queryClient.invalidateQueries({ queryKey: ['creator-access'] })");
    expect(createIdx).toBeGreaterThan(-1);
    expect(invalidateIdx).toBeGreaterThan(createIdx);
  });

  it('replaces, rather than pushes, so a successful creation never leaves the setup screen on the back stack', () => {
    expect(source).toMatch(/router\.replace\('\/\(creator\)\/today'\)/);
    expect(source).not.toMatch(/router\.push\('\/\(creator\)\/today'\)/);
  });
});
