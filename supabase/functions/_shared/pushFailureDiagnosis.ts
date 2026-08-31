export type PushFailure = {
  status_code?: number | null;
  content?: unknown;
};

export type PushFailureDiagnosis = {
  kind: 'mixed' | 'runtime_unavailable' | 'authorization' | 'provider_or_function' | 'unknown';
  summary: string;
  action: string;
};

export function diagnosePushFailures(failures: PushFailure[]): PushFailureDiagnosis {
  const bodies = failures.map((failure) => String(failure.content ?? ''));
  const hasRuntimeFailure = failures.some((_failure, index) =>
    bodies[index].includes('SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED')
  );
  const hasAuthorizationFailure = failures.some((failure) =>
    failure.status_code === 401 || failure.status_code === 403
  );

  if (hasRuntimeFailure && hasAuthorizationFailure) {
    return {
      kind: 'mixed',
      summary: 'The sample contains both a temporary Edge Runtime outage and an authorization rejection.',
      action: 'Investigate the authorization failure now. Do not dismiss it as part of the temporary 503.',
    };
  }

  if (hasAuthorizationFailure) {
    return {
      kind: 'authorization',
      summary: 'An Edge Function invocation was rejected for authorization.',
      action: 'Verify the function run-token and verify_jwt deployment setting before redeploying.',
    };
  }

  if (hasRuntimeFailure) {
    return {
      kind: 'runtime_unavailable',
      summary: 'Supabase Edge Runtime was temporarily unavailable before the push provider was called.',
      action: 'Check whether a later trigger drained the still-pending app notification. Do not change JWT or provider credentials for this 503.',
    };
  }

  if (failures.some((failure) => (failure.status_code ?? 0) >= 400)) {
    return {
      kind: 'provider_or_function',
      summary: 'An Edge Function ran or was admitted but returned an error.',
      action: 'Inspect the named function logs and recovery queue. Do not assume stale device tokens without a provider response saying so.',
    };
  }

  return {
    kind: 'unknown',
    summary: 'The push monitor found a failure it could not classify.',
    action: 'Inspect the recorded response and function logs before changing production settings.',
  };
}
