// Resolves to `fallback` if `p` does not settle within `ms`, and also if
// `p` rejects — it never throws and never hangs. Generalizes the inline
// `Promise.race([..., setTimeout(() => resolve(null), 6000)])` pattern
// that previously guarded only getSession() in app/_layout.tsx. Used to
// bound every network/auth call in the cold-start gate so a stale/expired
// session or a slow/offline network can never freeze the app on the
// auth-loading overlay (incident 2026-05-18, thread 3).
// Accepts PromiseLike so it works with both native Promises and Supabase
// query builders (which are thenable but not Promise instances).
export function withTimeout<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    p.then(finish, () => finish(fallback));
    setTimeout(() => finish(fallback), ms);
  });
}

// Like withTimeout, but REJECTS on timeout instead of resolving to a fallback,
// and passes through `p`'s own resolution or rejection unchanged. Use this
// when the caller still wants normal success/error semantics (e.g. React Query
// retry + isError) but must never hang on a request that never settles.
// supabase-js has no client-side request timeout, so a half-open socket on a
// flaky connection leaves a query pending forever — which keeps a loading gate
// (e.g. the Plans welcome overlay) up indefinitely. This converts that hang
// into an ordinary rejection so the query can retry and eventually settle.
export function withDeadline<T>(p: PromiseLike<T>, ms: number, label = 'request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const settle = (cb: (v: any) => void, v: any) => {
      if (done) return;
      done = true;
      cb(v);
    };
    p.then((v) => settle(resolve, v), (e) => settle(reject, e));
    setTimeout(() => settle(reject, new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}
