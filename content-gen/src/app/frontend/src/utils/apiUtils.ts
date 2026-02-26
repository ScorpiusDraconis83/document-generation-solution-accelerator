/**
 * Production-grade API utilities — retry with exponential backoff,
 * request deduplication cache, and throttle.
 *
 * These harden the HTTP layer for unreliable networks and prevent
 * accidental duplicate requests (e.g. double-clicks, React strict mode).
 */

/* ------------------------------------------------------------------ */
/*  retryRequest — exponential backoff wrapper                         */
/* ------------------------------------------------------------------ */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry. Default: 1 000. */
  initialDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30 000. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each failure. Default: 2. */
  backoffFactor?: number;
  /** Optional predicate — return `true` if the request should be retried. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional `AbortSignal` to cancel outstanding retries. */
  signal?: AbortSignal;
}

/**
 * Execute `fn` with automatic retries and exponential backoff.
 *
 * ```ts
 * const data = await retryRequest(() => httpClient.get('/health'), {
 *   maxAttempts: 4,
 *   initialDelayMs: 500,
 * });
 * ```
 */
export async function retryRequest<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    backoffFactor = 2,
    shouldRetry = defaultShouldRetry,
    signal,
  } = opts;

  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) throw error;
      if (signal?.aborted) throw new DOMException('Retry aborted', 'AbortError');

      await sleep(delay, signal);
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  // Unreachable — the loop always returns or throws.
  throw new Error('retryRequest: exhausted all attempts');
}

/* ------------------------------------------------------------------ */
/*  RequestCache — deduplication / in-flight coalescing                */
/* ------------------------------------------------------------------ */

/**
 * Simple in-memory cache that de-duplicates concurrent identical requests.
 *
 * If a request with the same `key` is already in flight, all callers
 * share the same promise. Once settled the entry is automatically
 * evicted (or kept for `ttlMs` when configured).
 *
 * ```ts
 * const cache = new RequestCache();
 * const data = await cache.dedupe('config', () => httpClient.get('/config'));
 * ```
 */
export class RequestCache {
  private inflight = new Map<string, Promise<unknown>>();
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlMs = 0) {
    this.ttlMs = ttlMs;
  }

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Return from TTL cache if still fresh
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    // De-duplicate in-flight requests
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);

    if (this.ttlMs > 0) {
      promise.then((value) => {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      }).catch(() => { /* don't cache failures */ });
    }

    return promise as Promise<T>;
  }

  /** Manually evict a cache entry. */
  invalidate(key: string): void {
    this.store.delete(key);
    this.inflight.delete(key);
  }

  /** Evict all cache entries. */
  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  throttle — limits invocation frequency                             */
/* ------------------------------------------------------------------ */

/**
 * Classic trailing-edge throttle.
 *
 * Ensures `fn` is called at most once every `limitMs` milliseconds.
 * The first invocation fires immediately; subsequent calls within the
 * window are silently dropped and the **last** one fires when the
 * window closes.
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limitMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limitMs - (now - lastCallTime);

    if (remaining <= 0) {
      // Window has passed — fire immediately
      lastCallTime = now;
      fn(...args);
    } else {
      // Inside the window — schedule a trailing call
      lastArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          lastCallTime = Date.now();
          timer = null;
          if (lastArgs) {
            fn(...lastArgs);
            lastArgs = null;
          }
        }, remaining);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helpers (not exported)                                    */
/* ------------------------------------------------------------------ */

/** Default retry predicate — retry on network errors & 5xx, not on 4xx. */
function defaultShouldRetry(error: unknown, _attempt: number): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof Response) return error.status >= 500;
  return true; // network errors, timeouts, etc.
}

/** Abort-aware sleep. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Sleep aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Sleep aborted', 'AbortError'));
    }, { once: true });
  });
}
