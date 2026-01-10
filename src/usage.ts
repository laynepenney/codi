/**
 * Usage tracking and cost estimation for API calls.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { TokenUsage } from './types.js';

/** Directory where usage data is stored */
const USAGE_DIR = path.join(homedir(), '.codi');
const USAGE_FILE = path.join(USAGE_DIR, 'usage.json');

/**
 * Pricing per 1M tokens (in USD) for various models.
 * Prices as of early 2025.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude models
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

  // OpenAI GPT models
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3-mini': { input: 1.1, output: 4.4 },

  // Default for unknown models (free/local)
  'default': { input: 0, output: 0 },
};

/**
 * A single usage record.
 */
export interface UsageRecord {
  /** Timestamp of the request */
  timestamp: string;
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens used */
  outputTokens: number;
  /** Estimated cost in USD */
  cost: number;
  /** Tokens read from cache (Anthropic) */
  cacheReadInputTokens?: number;
  /** Tokens used to create cache (Anthropic) */
  cacheCreationInputTokens?: number;
  /** Tokens served from cache (OpenAI) */
  cachedInputTokens?: number;
  /** Cost savings from cache */
  cacheSavings?: number;
}

/**
 * Aggregated usage statistics.
 */
export interface UsageStats {
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
  /** Total estimated cost in USD */
  totalCost: number;
  /** Number of requests */
  requestCount: number;
  /** Usage by provider */
  byProvider: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    requests: number;
  }>;
  /** Usage by model */
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    requests: number;
  }>;
}

/**
 * Session usage for current session only.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  startTime: string;
  /** Total tokens served from cache */
  cachedTokens: number;
  /** Total cost savings from cache */
  cacheSavings: number;
}

/**
 * Usage data file structure.
 */
interface UsageData {
  records: UsageRecord[];
  version: number;
}

// Session-level tracking (not persisted until session ends)
let sessionUsage: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  requests: 0,
  startTime: new Date().toISOString(),
  cachedTokens: 0,
  cacheSavings: 0,
};

/**
 * Ensure usage directory exists.
 */
function ensureUsageDir(): void {
  if (!fs.existsSync(USAGE_DIR)) {
    fs.mkdirSync(USAGE_DIR, { recursive: true });
  }
}

/**
 * Load usage data from file.
 */
function loadUsageData(): UsageData {
  ensureUsageDir();

  if (!fs.existsSync(USAGE_FILE)) {
    return { records: [], version: 1 };
  }

  try {
    const content = fs.readFileSync(USAGE_FILE, 'utf-8');
    return JSON.parse(content) as UsageData;
  } catch {
    return { records: [], version: 1 };
  }
}

/**
 * Save usage data to file.
 */
function saveUsageData(data: UsageData): void {
  ensureUsageDir();
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get pricing for a model.
 */
function getModelPricing(model: string): { input: number; output: number } {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try prefix match (e.g., "claude-3-sonnet" matches "claude-3-sonnet-20240229")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return pricing;
    }
  }

  // Default (free/local models)
  return MODEL_PRICING['default'];
}

/**
 * Calculate cost for token usage.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Calculate actual input cost with cache pricing.
 * Anthropic: input_tokens is non-cached only, cache_read at 10%, cache_write at 125%
 * OpenAI: cached_tokens are 50% off
 */
function calculateInputCostWithCache(
  model: string,
  usage: TokenUsage
): { cost: number; savings: number; cachedTokens: number } {
  const pricing = getModelPricing(model);
  let cost = 0;
  let savings = 0;
  let cachedTokens = 0;

  // Anthropic-style: input_tokens is non-cached, cache metrics are separate
  const cacheRead = usage.cacheReadInputTokens || 0;
  const cacheWrite = usage.cacheCreationInputTokens || 0;

  if (cacheRead > 0 || cacheWrite > 0) {
    // Regular (non-cached) tokens at full price
    const regularCost = (usage.inputTokens / 1_000_000) * pricing.input;
    // Cache reads at 10% of normal price
    const cacheReadCost = (cacheRead / 1_000_000) * pricing.input * 0.1;
    // Cache writes at 125% of normal price
    const cacheWriteCost = (cacheWrite / 1_000_000) * pricing.input * 1.25;

    cost = regularCost + cacheReadCost + cacheWriteCost;
    cachedTokens = cacheRead;

    // Savings = what we would have paid without caching
    const totalTokens = usage.inputTokens + cacheRead + cacheWrite;
    const fullCost = (totalTokens / 1_000_000) * pricing.input;
    savings = fullCost - cost;
  } else if (usage.cachedInputTokens) {
    // OpenAI-style: cached_tokens are part of input_tokens at 50% off
    const nonCached = usage.inputTokens - usage.cachedInputTokens;
    const regularCost = (nonCached / 1_000_000) * pricing.input;
    const cachedCost = (usage.cachedInputTokens / 1_000_000) * pricing.input * 0.5;

    cost = regularCost + cachedCost;
    cachedTokens = usage.cachedInputTokens;

    const fullCost = (usage.inputTokens / 1_000_000) * pricing.input;
    savings = fullCost - cost;
  } else {
    // No caching
    cost = (usage.inputTokens / 1_000_000) * pricing.input;
  }

  return { cost, savings, cachedTokens };
}

/**
 * Record usage from a provider response.
 */
export function recordUsage(
  provider: string,
  model: string,
  usage: TokenUsage | undefined
): void {
  if (!usage) return;

  const { cost: inputCost, savings, cachedTokens } = calculateInputCostWithCache(model, usage);
  const outputCost = (usage.outputTokens / 1_000_000) * getModelPricing(model).output;
  const cost = inputCost + outputCost;

  // Update session usage
  sessionUsage.inputTokens += usage.inputTokens;
  sessionUsage.outputTokens += usage.outputTokens;
  sessionUsage.cost += cost;
  sessionUsage.requests += 1;
  sessionUsage.cachedTokens += cachedTokens;
  sessionUsage.cacheSavings += savings;

  // Create record
  const record: UsageRecord = {
    timestamp: new Date().toISOString(),
    provider,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheSavings: savings > 0 ? savings : undefined,
  };

  // Append to file
  const data = loadUsageData();
  data.records.push(record);

  // Keep only last 1000 records
  if (data.records.length > 1000) {
    data.records = data.records.slice(-1000);
  }

  saveUsageData(data);
}

/**
 * Get current session usage.
 */
export function getSessionUsage(): SessionUsage {
  return { ...sessionUsage };
}

/**
 * Reset session usage.
 */
export function resetSessionUsage(): void {
  sessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    requests: 0,
    startTime: new Date().toISOString(),
    cachedTokens: 0,
    cacheSavings: 0,
  };
}

/**
 * Get aggregated usage statistics.
 */
export function getUsageStats(days: number = 30): UsageStats {
  const data = loadUsageData();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    requestCount: 0,
    byProvider: {},
    byModel: {},
  };

  for (const record of data.records) {
    const recordDate = new Date(record.timestamp);
    if (recordDate < cutoff) continue;

    stats.totalInputTokens += record.inputTokens;
    stats.totalOutputTokens += record.outputTokens;
    stats.totalCost += record.cost;
    stats.requestCount += 1;

    // By provider
    if (!stats.byProvider[record.provider]) {
      stats.byProvider[record.provider] = {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        requests: 0,
      };
    }
    stats.byProvider[record.provider].inputTokens += record.inputTokens;
    stats.byProvider[record.provider].outputTokens += record.outputTokens;
    stats.byProvider[record.provider].cost += record.cost;
    stats.byProvider[record.provider].requests += 1;

    // By model
    if (!stats.byModel[record.model]) {
      stats.byModel[record.model] = {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        requests: 0,
      };
    }
    stats.byModel[record.model].inputTokens += record.inputTokens;
    stats.byModel[record.model].outputTokens += record.outputTokens;
    stats.byModel[record.model].cost += record.cost;
    stats.byModel[record.model].requests += 1;
  }

  return stats;
}

/**
 * Get recent usage records.
 */
export function getRecentUsage(limit: number = 20): UsageRecord[] {
  const data = loadUsageData();
  return data.records.slice(-limit).reverse();
}

/**
 * Clear all usage history.
 */
export function clearUsageHistory(): number {
  const data = loadUsageData();
  const count = data.records.length;
  data.records = [];
  saveUsageData(data);
  return count;
}

/**
 * Format cost as currency string.
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token count with K/M suffix.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Get the usage file path.
 */
export function getUsageFilePath(): string {
  return USAGE_FILE;
}
