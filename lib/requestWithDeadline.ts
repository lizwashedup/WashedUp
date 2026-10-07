type AbortableRead<T> = PromiseLike<T> & { abortSignal?(signal: AbortSignal): PromiseLike<T> };

export class RequestDeadlineError extends Error {
  constructor() { super('The request took too long. Please try again.'); this.name = 'RequestDeadlineError'; }
}

/** React Native provides AbortController, but not AbortSignal.timeout. */
export async function requestWithDeadline<T>(request: AbortableRead<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = request.abortSignal ? request.abortSignal(controller.signal) : request;
    return await Promise.race([
      Promise.resolve(pending),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RequestDeadlineError());
          controller.abort();
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
