import fs from 'node:fs';
import path from 'node:path';
import { communityRouteDecision } from '../communityRouteGate';

const gatedDirectories = ['communities', 'community', 'community-thread', 'community-topic'];

// The three creator-linked routes: a real grant-holding creator's own rooms
// and public-page previews (linked from app/(creator)/menu.tsx and
// app/creator/edit-page.tsx) must stay reachable through these routes while
// COMMUNITIES_ENABLED is off, mirroring app/(creator)/_layout.tsx's own
// grant-based bypass.
const grantExceptionDirectories = ['community', 'community-thread', 'community-topic'];

describe('community route gate', () => {
  it('fails closed for the general public without changing the enabled destination', () => {
    expect(communityRouteDecision(false, false)).toEqual({
      allowed: false,
      redirect: '/(tabs)/explore',
    });
    expect(communityRouteDecision(true, false)).toEqual({ allowed: true });
    expect(communityRouteDecision(true, true)).toEqual({ allowed: true });
  });

  it('admits a real grant-holding creator even while the flag is off', () => {
    expect(communityRouteDecision(false, true)).toEqual({ allowed: true });
  });

  it('defaults hasGrant to false for a caller that only passes enabled', () => {
    // Guards app/communities/_layout.tsx, which still calls this with one
    // argument: it must keep today's exception-less behavior unchanged.
    expect(communityRouteDecision(false)).toEqual({
      allowed: false,
      redirect: '/(tabs)/explore',
    });
    expect(communityRouteDecision(true)).toEqual({ allowed: true });
  });

  it('wraps every community-only route directory', () => {
    for (const directory of gatedDirectories) {
      const source = fs.readFileSync(path.join(process.cwd(), 'app', directory, '_layout.tsx'), 'utf8');
      expect(source).toContain('COMMUNITIES_ENABLED');
      expect(source).toContain('communityRouteDecision');
      expect(source).toContain('<Slot />');
    }
  });

  it('wires the grant-based exception into every creator-linked community route', () => {
    for (const directory of grantExceptionDirectories) {
      const source = fs.readFileSync(path.join(process.cwd(), 'app', directory, '_layout.tsx'), 'utf8');
      expect(source).toContain('hasCreatorAccess');
      expect(source).toContain('getCreatorAccess');
    }
  });
});
