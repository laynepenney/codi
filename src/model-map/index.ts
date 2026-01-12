/**
 * Model Map Module
 *
 * Docker-compose style multi-model orchestration for Codi.
 */

// Types
export * from './types.js';

// Loader
export {
  loadModelMap,
  validateModelMap,
  watchModelMap,
  getExampleModelMap,
  initModelMap as initModelMapFile,
  ModelMapValidationError,
  type ValidationResult,
} from './loader.js';

// Registry
export {
  ModelRegistry,
  createModelRegistry,
  type RegistryOptions,
} from './registry.js';

// Router
export {
  TaskRouter,
  createTaskRouter,
  type RoutingResult,
} from './router.js';

// Executor
export {
  PipelineExecutor,
  createPipelineExecutor,
  type PipelineCallbacks,
  type PipelineExecuteOptions,
} from './executor.js';

// V3 Types (re-exported from types.ts)
export type {
  V3Options,
  V3Callbacks,
  TriageOptions,
  TriageResult,
  FileScore,
  RiskLevel,
} from './types.js';

// Grouping
export {
  groupFiles,
  groupByHierarchy,
  groupByAI,
  groupHybrid,
  processInParallel,
} from './grouping.js';

// Triage (V3)
export {
  triageFiles,
  getSuggestedModel,
  formatTriageResult,
} from './triage.js';

// --- Convenience functions ---

import { loadModelMap, validateModelMap } from './loader.js';
import { createModelRegistry } from './registry.js';
import { createTaskRouter } from './router.js';
import { createPipelineExecutor } from './executor.js';
import type { ModelMapConfig } from './types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import type { PipelineExecutor } from './executor.js';

/**
 * Complete model map instance with all components.
 */
export interface ModelMap {
  config: ModelMapConfig;
  configPath: string | null;
  registry: ModelRegistry;
  router: TaskRouter;
  executor: PipelineExecutor;
  /** Reload configuration from disk */
  reload: () => boolean;
  /** Shutdown and cleanup */
  shutdown: () => void;
}

/**
 * Initialize a complete model map from the current directory.
 *
 * @param cwd Working directory to load config from
 * @returns ModelMap instance or null if no config found
 */
export function initModelMap(cwd: string = process.cwd()): ModelMap | null {
  const { config, configPath, error } = loadModelMap(cwd);

  if (!config) {
    if (error) {
      console.warn(`Model map error: ${error}`);
    }
    return null;
  }

  // Validate
  const validation = validateModelMap(config);
  if (!validation.valid) {
    console.error('Model map validation errors:');
    for (const err of validation.errors) {
      console.error(`  - ${err.message}`);
    }
    return null;
  }
  if (validation.warnings.length > 0) {
    for (const warn of validation.warnings) {
      console.warn(`Model map warning: ${warn}`);
    }
  }

  // Create components
  const registry = createModelRegistry(config);
  const router = createTaskRouter(config, registry);
  const executor = createPipelineExecutor(registry, router);

  const reload = (): boolean => {
    const result = loadModelMap(cwd);
    if (result.config) {
      const revalidation = validateModelMap(result.config);
      if (revalidation.valid) {
        registry.updateConfig(result.config);
        router.updateConfig(result.config);
        return true;
      }
    }
    return false;
  };

  const shutdown = (): void => {
    registry.shutdown();
  };

  return {
    config,
    configPath,
    registry,
    router,
    executor,
    reload,
    shutdown,
  };
}
