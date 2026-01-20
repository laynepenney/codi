// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rate Limiter for API requests
 *
 * Implements a token bucket algorithm to enforce request rate limits.
 * Designed for rate-limited APIs like Ollama cloud (~1 req/sec).
 */

export interface RateLimiterOptions {
  /** Maximum concurrent requests (tokens in bucket). Default: 2 */
  maxTokens?: number;
  /** How many tokens to add per second. Default: 1 */
  refillRate?: number;
  /** Starting tokens. Default: maxTokens */
  initialTokens?: number;
  /** Minimum gap between requests in ms. Default: 0 (no minimum) */
  minRequestGap?: number;
  /** Optional name for debugging */
  name?: string;
}

export interface RateLimiter {
  /** Acquire a slot (waits if none available) */
  acquire(): Promise<void>;
  /** Release a slot (call when request completes) */
  release(): void;
  /** Schedule a function to run with rate limiting */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  /** Get current stats */
  getStats(): RateLimiterStats;
  /** Shutdown and reject pending requests */
  shutdown(): void;
}

export interface RateLimiterStats {
  availableTokens: number;
  maxTokens: number;
  queueLength: number;
  totalAcquired: number;
  totalReleased: number;
}

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Token bucket rate limiter with request queueing
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly minRequestGap: number;
  private readonly name: string;
  private lastRefillTime: number;
  private lastRequestTime: number = 0;
  private queue: QueuedRequest[] = [];
  private isShutdown = false;
  private refillInterval: ReturnType<typeof setInterval> | null = null;

  // Stats
  private totalAcquired = 0;
  private totalReleased = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.maxTokens = options.maxTokens ?? 2;
    this.refillRate = options.refillRate ?? 1;
    this.tokens = options.initialTokens ?? this.maxTokens;
    this.minRequestGap = options.minRequestGap ?? 0;
    this.name = options.name ?? 'rate-limiter';
    this.lastRefillTime = Date.now();

    // Start background refill
    this.startRefillTimer();
  }

  private startRefillTimer(): void {
    // Refill tokens every 100ms for smooth rate limiting
    this.refillInterval = setInterval(() => {
      this.refillTokens();
      this.processQueue();
    }, 100);
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;

    if (tokensToAdd >= 0.1) {
      // Only add if meaningful amount
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.canAcquire()) {
      const request = this.queue.shift();
      if (request) {
        this.doAcquire();
        request.resolve();
      }
    }
  }

  private canAcquire(): boolean {
    if (this.tokens < 1) return false;

    // Check minimum gap
    if (this.minRequestGap > 0) {
      const elapsed = Date.now() - this.lastRequestTime;
      if (elapsed < this.minRequestGap) return false;
    }

    return true;
  }

  private doAcquire(): void {
    this.tokens -= 1;
    this.lastRequestTime = Date.now();
    this.totalAcquired++;
  }

  async acquire(): Promise<void> {
    if (this.isShutdown) {
      throw new Error('Rate limiter has been shut down');
    }

    // Try immediate acquire
    this.refillTokens();
    if (this.canAcquire()) {
      this.doAcquire();
      return;
    }

    // Queue the request
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  release(): void {
    this.totalReleased++;
    // Tokens are replenished by the refill timer, not by release
    // This allows for proper rate limiting even with long-running requests
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  getStats(): RateLimiterStats {
    this.refillTokens();
    return {
      availableTokens: Math.floor(this.tokens * 100) / 100,
      maxTokens: this.maxTokens,
      queueLength: this.queue.length,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
    };
  }

  shutdown(): void {
    this.isShutdown = true;

    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }

    // Reject all pending requests
    const error = new Error('Rate limiter shut down');
    for (const request of this.queue) {
      request.reject(error);
    }
    this.queue = [];
  }
}

/**
 * Provider-specific rate limiter configurations
 */
export const PROVIDER_RATE_LIMITS: Record<string, RateLimiterOptions> = {
  // Ollama cloud has strict rate limits (~1 req/sec)
  // Use maxTokens: 1 to ensure only 1 concurrent request
  // and minRequestGap: 1500 to provide buffer for retries
  ollama: {
    maxTokens: 1,
    refillRate: 0.5, // 1 token every 2 seconds
    minRequestGap: 1500,
    name: 'ollama',
  },
  // OpenAI has generous limits
  openai: {
    maxTokens: 50,
    refillRate: 20,
    minRequestGap: 0,
    name: 'openai',
  },
  // Anthropic has moderate limits
  anthropic: {
    maxTokens: 10,
    refillRate: 5,
    minRequestGap: 100,
    name: 'anthropic',
  },
  // Default for unknown providers
  default: {
    maxTokens: 5,
    refillRate: 2,
    minRequestGap: 200,
    name: 'default',
  },
};

/**
 * Get rate limiter options for a provider
 */
export function getRateLimiterOptions(provider: string): RateLimiterOptions {
  const normalized = provider.toLowerCase();

  // Check for known providers
  if (normalized.includes('ollama')) {
    return PROVIDER_RATE_LIMITS.ollama;
  }
  if (normalized.includes('openai')) {
    return PROVIDER_RATE_LIMITS.openai;
  }
  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return PROVIDER_RATE_LIMITS.anthropic;
  }

  return PROVIDER_RATE_LIMITS.default;
}

/**
 * Global rate limiter registry (one per provider)
 */
const rateLimiterRegistry = new Map<string, TokenBucketRateLimiter>();

/**
 * Get or create a rate limiter for a provider
 */
export function getProviderRateLimiter(provider: string): RateLimiter {
  const key = provider.toLowerCase();

  let limiter = rateLimiterRegistry.get(key);
  if (!limiter) {
    const options = getRateLimiterOptions(provider);
    limiter = new TokenBucketRateLimiter(options);
    rateLimiterRegistry.set(key, limiter);
  }

  return limiter;
}

/**
 * Shutdown all rate limiters
 */
export function shutdownAllRateLimiters(): void {
  for (const limiter of rateLimiterRegistry.values()) {
    limiter.shutdown();
  }
  rateLimiterRegistry.clear();
}
