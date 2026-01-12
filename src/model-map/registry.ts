/**
 * Model Registry
 *
 * Manages lazy provider instantiation with connection pooling.
 */

import type { BaseProvider } from '../providers/base.js';
import { createProvider, type CreateProviderOptions } from '../providers/index.js';
import type { ModelMapConfig, ModelDefinition, ResolvedModel } from './types.js';

/** Default pool settings */
const DEFAULT_MAX_POOL_SIZE = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Pooled provider entry with usage tracking.
 */
interface PooledProvider {
  provider: BaseProvider;
  modelName: string;
  lastUsed: number;
  useCount: number;
}

/**
 * Registry configuration.
 */
export interface RegistryOptions {
  /** Maximum number of providers to keep in pool */
  maxPoolSize?: number;
  /** Milliseconds before idle providers are removed */
  idleTimeoutMs?: number;
}

/**
 * Model Registry for managing provider instances.
 *
 * Features:
 * - Lazy provider instantiation (created on first use)
 * - Connection pooling with configurable size
 * - Automatic cleanup of idle connections
 * - Fallback chain support
 */
export class ModelRegistry {
  private config: ModelMapConfig;
  private pool: Map<string, PooledProvider> = new Map();
  private maxPoolSize: number;
  private idleTimeoutMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: ModelMapConfig, options: RegistryOptions = {}) {
    this.config = config;
    this.maxPoolSize = options.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Get a provider for a named model.
   * Creates the provider lazily if not in pool.
   */
  getProvider(modelName: string): BaseProvider {
    // Check pool first
    const pooled = this.pool.get(modelName);
    if (pooled) {
      pooled.lastUsed = Date.now();
      pooled.useCount++;
      return pooled.provider;
    }

    // Get model definition
    const definition = this.config.models[modelName];
    if (!definition) {
      throw new Error(`Unknown model: ${modelName}`);
    }

    // Create provider
    const provider = this.createProviderFromDefinition(modelName, definition);

    // Add to pool (evict if necessary)
    this.addToPool(modelName, provider);

    return provider;
  }

  /**
   * Get a provider with fallback chain.
   * Tries each model in the chain until one succeeds.
   */
  getProviderWithFallback(fallbackChainName: string): BaseProvider {
    const chain = this.config.fallbacks?.[fallbackChainName];
    if (!chain || chain.length === 0) {
      throw new Error(`Unknown fallback chain: ${fallbackChainName}`);
    }

    let lastError: Error | null = null;

    for (const modelName of chain) {
      try {
        return this.getProvider(modelName);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next in chain
      }
    }

    throw new Error(
      `All models in fallback chain "${fallbackChainName}" failed. Last error: ${lastError?.message}`
    );
  }

  /**
   * Resolve a model name to its full definition.
   */
  resolveModel(modelName: string): ResolvedModel {
    const definition = this.config.models[modelName];
    if (!definition) {
      throw new Error(`Unknown model: ${modelName}`);
    }

    return {
      name: modelName,
      provider: definition.provider,
      model: definition.model,
      definition,
    };
  }

  /**
   * Get all model names in the configuration.
   */
  getModelNames(): string[] {
    return Object.keys(this.config.models);
  }

  /**
   * Get model definition by name.
   */
  getModelDefinition(name: string): ModelDefinition | undefined {
    return this.config.models[name];
  }

  /**
   * Check if a model exists in the configuration.
   */
  hasModel(name: string): boolean {
    return name in this.config.models;
  }

  /**
   * Get pool statistics.
   */
  getPoolStats(): {
    size: number;
    maxSize: number;
    models: Array<{ name: string; useCount: number; lastUsed: Date }>;
  } {
    return {
      size: this.pool.size,
      maxSize: this.maxPoolSize,
      models: Array.from(this.pool.entries()).map(([name, pooled]) => ({
        name,
        useCount: pooled.useCount,
        lastUsed: new Date(pooled.lastUsed),
      })),
    };
  }

  /**
   * Clear the provider pool.
   */
  clearPool(): void {
    this.pool.clear();
  }

  /**
   * Shutdown the registry and cleanup resources.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearPool();
  }

  /**
   * Update the configuration (for hot-reload).
   */
  updateConfig(config: ModelMapConfig): void {
    this.config = config;
    // Clear pool since models may have changed
    this.clearPool();
  }

  // --- Private methods ---

  private createProviderFromDefinition(
    modelName: string,
    definition: ModelDefinition
  ): BaseProvider {
    const options: CreateProviderOptions = {
      type: definition.provider,
      model: definition.model,
      baseUrl: definition.baseUrl,
    };

    try {
      return createProvider(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create provider for model "${modelName}": ${message}`);
    }
  }

  private addToPool(modelName: string, provider: BaseProvider): void {
    // Evict oldest if at capacity
    if (this.pool.size >= this.maxPoolSize) {
      this.evictOldest();
    }

    this.pool.set(modelName, {
      provider,
      modelName,
      lastUsed: Date.now(),
      useCount: 1,
    });
  }

  private evictOldest(): void {
    let oldest: { name: string; lastUsed: number } | null = null;

    for (const [name, pooled] of this.pool.entries()) {
      if (!oldest || pooled.lastUsed < oldest.lastUsed) {
        oldest = { name, lastUsed: pooled.lastUsed };
      }
    }

    if (oldest) {
      this.pool.delete(oldest.name);
    }
  }

  private startCleanupTimer(): void {
    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleProviders();
    }, 60 * 1000);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupIdleProviders(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [name, pooled] of this.pool.entries()) {
      if (now - pooled.lastUsed > this.idleTimeoutMs) {
        toRemove.push(name);
      }
    }

    for (const name of toRemove) {
      this.pool.delete(name);
    }
  }
}

/**
 * Create a model registry from configuration.
 */
export function createModelRegistry(
  config: ModelMapConfig,
  options?: RegistryOptions
): ModelRegistry {
  return new ModelRegistry(config, options);
}
