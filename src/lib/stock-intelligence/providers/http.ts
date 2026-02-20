import { nowIso } from '../dates';
import { appendAudit } from '../storage';

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
  status: number;
  fetchedAt: string;
};

const cache = new Map<string, CacheEntry>();

class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(): boolean {
    if (this.failures < this.failureThreshold) return false;
    return Date.now() - this.openedAt < this.cooldownMs;
  }

  markSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  markFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold && this.openedAt === 0) {
      this.openedAt = Date.now();
    }
  }
}

class RateLimiter {
  private nextAllowedMs = 0;

  constructor(private readonly minIntervalMs: number) {}

  async waitTurn(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, this.nextAllowedMs - now);
    this.nextAllowedMs = Math.max(this.nextAllowedMs, now) + this.minIntervalMs;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();
const limiters = new Map<string, RateLimiter>();

function getBreaker(provider: string): CircuitBreaker {
  const existing = breakers.get(provider);
  if (existing) return existing;
  const created = new CircuitBreaker(4, 120_000);
  breakers.set(provider, created);
  return created;
}

function getLimiter(provider: string): RateLimiter {
  const existing = limiters.get(provider);
  if (existing) return existing;
  const interval = provider === 'finnhub' ? 350 : provider === 'fred' ? 300 : 100;
  const created = new RateLimiter(interval);
  limiters.set(provider, created);
  return created;
}

export interface FetchCachedJsonOptions {
  provider: string;
  key: string;
  url: string;
  ttlMs: number;
}

export interface FetchResult {
  data: unknown | null;
  status: number;
  error: string | null;
  source: 'network' | 'cache' | 'none';
}

function getFromCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, payload: unknown, status: number, ttlMs: number): CacheEntry {
  const entry: CacheEntry = {
    payload,
    status,
    expiresAt: Date.now() + ttlMs,
    fetchedAt: nowIso(),
  };
  cache.set(key, entry);
  return entry;
}

export async function fetchCachedJson(options: FetchCachedJsonOptions): Promise<FetchResult> {
  const cacheKey = `${options.provider}:${options.key}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    appendAudit({
      provider: options.provider,
      key: options.key,
      fetchedAt: nowIso(),
      status: cached.status,
      source: 'cache',
      payload: cached.payload,
    });
    return {
      data: cached.payload,
      status: cached.status,
      error: null,
      source: 'cache',
    };
  }

  const breaker = getBreaker(options.provider);
  if (breaker.isOpen()) {
    return {
      data: null,
      status: 503,
      error: `${options.provider} circuit open`,
      source: 'none',
    };
  }

  const limiter = getLimiter(options.provider);
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await limiter.waitTurn();
      const response = await fetch(options.url, { cache: 'no-store' });
      const status = response.status;
      const payload = await response.json().catch(() => null);
      if (status === 429 || status >= 500) {
        lastError = `HTTP ${status}`;
        breaker.markFailure();
        const delay = Math.pow(2, attempt) * 400;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        breaker.markFailure();
        appendAudit({
          provider: options.provider,
          key: options.key,
          fetchedAt: nowIso(),
          status,
          source: 'network',
          payload,
        });
        return {
          data: payload,
          status,
          error: `HTTP ${status}`,
          source: 'network',
        };
      }
      breaker.markSuccess();
      const entry = setCache(cacheKey, payload, status, options.ttlMs);
      appendAudit({
        provider: options.provider,
        key: options.key,
        fetchedAt: entry.fetchedAt,
        status,
        source: 'network',
        payload,
      });
      return {
        data: payload,
        status,
        error: null,
        source: 'network',
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      breaker.markFailure();
      const delay = Math.pow(2, attempt) * 400;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    data: null,
    status: 0,
    error: lastError,
    source: 'none',
  };
}

