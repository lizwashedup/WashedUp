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
