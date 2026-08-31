import { diagnosePushFailures } from '../_shared/pushFailureDiagnosis.ts';

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

Deno.test('classifies Supabase runtime degradation instead of blaming JWT or stale tokens', () => {
  const result = diagnosePushFailures([{
    status_code: 503,
    content: '{"code":"SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED","message":"Service is temporarily unavailable"}',
  }]);

  assertEquals(result.kind, 'runtime_unavailable');
  assertEquals(result.summary.includes('before the push provider was called'), true);
  assertEquals(result.action.includes('Do not change JWT'), true);
});

Deno.test('reserves JWT guidance for authorization failures', () => {
  const result = diagnosePushFailures([{ status_code: 403, content: 'forbidden' }]);
  assertEquals(result.kind, 'authorization');
  assertEquals(result.action.includes('verify_jwt'), true);
});

Deno.test('does not label a bare 503 as a confirmed Edge Runtime outage', () => {
  const result = diagnosePushFailures([{ status_code: 503, content: 'service unavailable' }]);
  assertEquals(result.kind, 'provider_or_function');
  assertEquals(result.summary.includes('before the push provider was called'), false);
});

Deno.test('does not hide an authorization failure behind a simultaneous runtime 503', () => {
  const result = diagnosePushFailures([
    { status_code: 503, content: 'SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED' },
    { status_code: 403, content: 'forbidden' },
  ]);
  assertEquals(result.kind, 'mixed');
  assertEquals(result.action.includes('Investigate the authorization failure now'), true);
});
