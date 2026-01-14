// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Retry utility with exponential backoff for provider API calls.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to delays (default: true) */
  jitter?: boolean;
  /** Function to determine if an error is retryable (default: checks for rate limits and network errors) */
  isRetryable?: (error: Error) => boolean;
  /** Callback when a retry occurs */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Default check for retryable errors.
 * Retries on rate limits, network errors, and server errors.
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Rate limit errors
  if (message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      message.includes('quota exceeded')) {
    return true;
  }

  // Network errors
  if (message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket') ||
      message.includes('fetch failed')) {
    return true;
  }

  // Server errors (5xx)
  if (message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('server error') ||
      message.includes('internal error')) {
    return true;
  }

  // Ollama-specific errors
  if (message.includes('ollama ap') || // Truncated "Ollama API" error
      message.includes('model is loading') ||
      message.includes('try again')) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitter: boolean
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (0-25% random variation)
  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random();
    delay += jitterAmount;
  }

  return Math.round(delay);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    jitter = DEFAULT_OPTIONS.jitter,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate delay for this retry
      const delayMs = calculateDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitter
      );

      // Notify about retry
      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error('Retry failed');
}

/**
 * Create a retry wrapper with pre-configured options.
 */
export function createRetryWrapper(defaultOptions: RetryOptions = {}) {
  return <T>(fn: () => Promise<T>, overrideOptions: RetryOptions = {}): Promise<T> => {
    return withRetry(fn, { ...defaultOptions, ...overrideOptions });
  };
}
