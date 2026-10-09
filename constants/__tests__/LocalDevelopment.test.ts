import { LOCAL_DEVELOPMENT_ONLY, requireLocalBackend } from '../LocalDevelopment';

// This checkout is the reconciled store-release source, not the former isolated redesign.
describe('release backend boundary', () => {
  it('uses the verified production backend in the shipping configuration', () => {
    expect(LOCAL_DEVELOPMENT_ONLY).toBe(false);
    expect(requireLocalBackend('https://upstjumasqblszevlgik.supabase.co')).toBe('https://upstjumasqblszevlgik.supabase.co');
  });
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://10.0.2.2:54321', 'http://[::1]:54321',
    'https://localhost.evil.example', 'https://example.com@upstjumasqblszevlgik.supabase.co',
    'https://upstjumasqblszevlgik.supabase.co/other', 'https://upstjumasqblszevlgik.supabase.co?key=value',
    'https://upstjumasqblszevlgik.supabase.co#fragment', 'ftp://127.0.0.1', ''])('rejects a different or malformed endpoint %s', (url) => {
    expect(() => requireLocalBackend(url)).toThrow();
  });
});
