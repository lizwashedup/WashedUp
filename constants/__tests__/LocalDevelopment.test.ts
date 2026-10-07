import { LOCAL_DEVELOPMENT_ONLY, requireLocalBackend } from '../LocalDevelopment';

describe('takeover workspace isolation', () => {
  it('requires review before production integrations can be enabled', () => {
    expect(LOCAL_DEVELOPMENT_ONLY).toBe(true);
  });
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://10.0.2.2:54321', 'http://[::1]:54321'])('accepts local backend %s', (url) => {
    expect(requireLocalBackend(url)).toBe(url);
  });
  it.each(['https://upstjumasqblszevlgik.supabase.co', 'https://localhost.evil.example', 'https://example.com@upstjumasqblszevlgik.supabase.co', 'ftp://127.0.0.1', ''])('rejects remote or malformed backend %s', (url) => {
    expect(() => requireLocalBackend(url)).toThrow();
  });
});
