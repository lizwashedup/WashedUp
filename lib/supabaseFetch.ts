const REQUEST_TIMEOUT_MS = 8000;
const AUTH_TOKEN_TIMEOUT_MS = 9000;

/** Preserve the SDK's refresh coordination and retry budget. In auth-js 2.97,
 * HTTP 500 is otherwise classified as a permanent error that deletes a session.
 * Only this project's refresh endpoint may turn a 5xx into a transport failure;
 * invalid/revoked tokens, OTP, and application mutations retain their semantics. */
export function createSupabaseFetch(baseUrl: string): typeof fetch {
  const tokenUrl = `${baseUrl.replace(/\/+$/, '')}/auth/v1/token`;
  return async (input, init) => {
    const url = typeof input === 'string' ? input
      : input && typeof input === 'object' && 'url' in input
        ? String(input.url) : String(input);

    // Large media transfers keep their existing caller-controlled lifetime.
    if (url.includes('/storage/v1/')) return fetch(input, init);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),
      url.includes('/auth/v1/token') ? AUTH_TOKEN_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const callerSignal = init?.signal ?? (
      input && typeof input === 'object' && 'signal' in input ? input.signal : undefined
    );
    const cancel = () => controller.abort();
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort', cancel, { once: true });

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const method = init?.method ?? (
        input && typeof input === 'object' && 'method' in input ? input.method : 'GET'
      );
      const [endpoint, query] = url.split('?');
      if (endpoint === tokenUrl && method.toUpperCase() === 'POST' &&
          new URLSearchParams(query).get('grant_type') === 'refresh_token' &&
          response.status >= 500 && response.status <= 599) {
        // Do not copy the response body or request (which contains credentials).
        // auth-js catches transport exceptions as AuthRetryableFetchError,
        // retries within its own budget, and retains storage if they persist.
        throw Object.assign(new Error(`Authentication service temporarily unavailable (HTTP ${response.status})`), {
          name: 'AuthServiceUnavailableError', status: response.status,
        });
      }
      return response;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', cancel);
    }
  };
}
