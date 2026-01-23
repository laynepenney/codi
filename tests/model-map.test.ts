// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadModelMap,
  loadProjectModelMap,
  validateModelMap,
  initModelMapFile,
  getExampleModelMap,
  ModelRegistry,
  TaskRouter,
  PipelineExecutor,
  initModelMap,
  DEFAULT_COMMAND_TASKS,
  type ModelMapConfig,
} from '../src/model-map/index.js';

describe('Model Map - Types', () => {
  it('should have default command tasks defined', () => {
    expect(DEFAULT_COMMAND_TASKS.commit).toBe('fast');
    expect(DEFAULT_COMMAND_TASKS.fix).toBe('complex');
    expect(DEFAULT_COMMAND_TASKS.explain).toBe('code');
  });
});

describe('Model Map - Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codi-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null when no project config file exists', () => {
    // Use loadProjectModelMap to test project-only behavior (ignores global config)
    const { config, configPath } = loadProjectModelMap(tempDir);
    expect(config).toBeNull();
    expect(configPath).toBeNull();
  });

  it('should load a valid YAML config', () => {
    const yaml = `
version: "1"
models:
  haiku:
    provider: anthropic
    model: claude-3-5-haiku-latest
tasks:
  fast:
    model: haiku
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), yaml);

    const { config, configPath, error } = loadModelMap(tempDir);
    expect(error).toBeUndefined();
    expect(config).not.toBeNull();
    expect(config?.models.haiku.provider).toBe('anthropic');
    expect(config?.tasks?.fast.model).toBe('haiku');
    expect(configPath).toContain('codi-models.yaml');
  });

  it('should load .yml extension as alternative', () => {
    const yaml = `
version: "1"
models:
  local:
    provider: ollama
    model: llama3.2
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yml'), yaml);

    const { config, error } = loadModelMap(tempDir);
    expect(error).toBeUndefined();
    expect(config).not.toBeNull();
    expect(config?.models.local.provider).toBe('ollama');
  });

  it('should return error for invalid YAML', () => {
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), 'invalid: yaml: content:');

    // Use loadProjectModelMap to test project-only behavior (ignores global config)
    const { config, error } = loadProjectModelMap(tempDir);
    expect(config).toBeNull();
    expect(error).toBeDefined();
  });

  it('should generate example config', () => {
    const example = getExampleModelMap();
    expect(example).toContain('version:');
    expect(example).toContain('models:');
    expect(example).toContain('haiku:');
    expect(example).toContain('sonnet:');
    expect(example).toContain('tasks:');
    expect(example).toContain('pipelines:');
  });

  it('should initialize a new config file', () => {
    const result = initModelMapFile(tempDir);
    expect(result.success).toBe(true);
    expect(result.path).toContain('codi-models.yaml');
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('should not overwrite existing config', () => {
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), 'existing: content');

    const result = initModelMapFile(tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});

describe('Model Map - Validator', () => {
  it('should validate a minimal valid config', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should require at least one model', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {},
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('At least one model'))).toBe(true);
  });

  it('should require provider and model in model definitions', () => {
    const config = {
      version: '1',
      models: {
        broken: { provider: '', model: '' } as any,
      },
    } as ModelMapConfig;

    const result = validateModelMap(config);
    expect(result.valid).toBe(false);
  });

  it('should validate task model references', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      tasks: {
        fast: { model: 'nonexistent' },
      },
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('unknown model'))).toBe(true);
  });

  it('should validate command references', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      tasks: {
        fast: { model: 'haiku' },
      },
      commands: {
        commit: { task: 'nonexistent' },
      },
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('unknown task'))).toBe(true);
  });

  it('should validate fallback chain references', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      fallbacks: {
        primary: ['haiku', 'nonexistent'],
      },
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('unknown model "nonexistent"'))).toBe(true);
  });

  it('should validate pipeline steps', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      pipelines: {
        test: {
          steps: [
            {
              name: 'step1',
              model: 'haiku',
              prompt: 'Test {input}',
              output: 'result',
            },
          ],
        },
      },
    };

    const result = validateModelMap(config);
    expect(result.valid).toBe(true);
  });

  it('should warn about undefined variable references in pipelines', () => {
    const config: ModelMapConfig = {
      version: '1',
      models: {
        haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      },
      pipelines: {
        test: {
          steps: [
            {
              name: 'step1',
              model: 'haiku',
              prompt: 'Test {undefined_var}',
              output: 'result',
            },
          ],
        },
      },
    };

    const result = validateModelMap(config);
    expect(result.warnings.some(w => w.includes('undefined_var'))).toBe(true);
  });
});

describe('Model Map - Registry', () => {
  const validConfig: ModelMapConfig = {
    version: '1',
    models: {
      haiku: { provider: 'ollama', model: 'llama3.2' }, // Use ollama for testing
      sonnet: { provider: 'ollama', model: 'llama3.2' },
    },
    fallbacks: {
      primary: ['haiku', 'sonnet'],
    },
  };

  it('should create a registry from config', () => {
    const registry = new ModelRegistry(validConfig);
    expect(registry.getModelNames()).toContain('haiku');
    expect(registry.getModelNames()).toContain('sonnet');
  });

  it('should check if models exist', () => {
    const registry = new ModelRegistry(validConfig);
    expect(registry.hasModel('haiku')).toBe(true);
    expect(registry.hasModel('nonexistent')).toBe(false);
  });

  it('should resolve model definitions', () => {
    const registry = new ModelRegistry(validConfig);
    const resolved = registry.resolveModel('haiku');
    expect(resolved.name).toBe('haiku');
    expect(resolved.provider).toBe('ollama');
    expect(resolved.model).toBe('llama3.2');
  });

  it('should throw for unknown models', () => {
    const registry = new ModelRegistry(validConfig);
    expect(() => registry.resolveModel('nonexistent')).toThrow('Unknown model');
  });

  it('should get pool stats', () => {
    const registry = new ModelRegistry(validConfig);
    const stats = registry.getPoolStats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(5);
  });

  it('should clear pool', () => {
    const registry = new ModelRegistry(validConfig);
    registry.clearPool();
    expect(registry.getPoolStats().size).toBe(0);
  });

  it('should shutdown cleanly', () => {
    const registry = new ModelRegistry(validConfig);
    registry.shutdown();
    expect(registry.getPoolStats().size).toBe(0);
  });
});

describe('Model Map - Router', () => {
  const validConfig: ModelMapConfig = {
    version: '1',
    models: {
      haiku: { provider: 'ollama', model: 'llama3.2' },
      sonnet: { provider: 'ollama', model: 'llama3.2' },
      opus: { provider: 'ollama', model: 'llama3.2' },
    },
    tasks: {
      fast: { model: 'haiku' },
      code: { model: 'sonnet' },
      complex: { model: 'opus' },
      summarize: { model: 'haiku' },
    },
    commands: {
      commit: { task: 'fast' },
      fix: { task: 'complex' },
    },
    fallbacks: {
      primary: ['sonnet', 'haiku'],
    },
  };

  let registry: ModelRegistry;
  let router: TaskRouter;

  beforeEach(() => {
    registry = new ModelRegistry(validConfig);
    router = new TaskRouter(validConfig, registry);
  });

  it('should route tasks to models', () => {
    const result = router.routeTask('fast');
    expect(result.type).toBe('model');
    if (result.type === 'model') {
      expect(result.model.name).toBe('haiku');
    }
  });

  it('should route commands via task', () => {
    const result = router.routeCommand('commit');
    expect(result.type).toBe('model');
    if (result.type === 'model') {
      expect(result.model.name).toBe('haiku');
    }
  });

  it('should use default task for commands without override', () => {
    // 'explain' has default task 'code' in DEFAULT_COMMAND_TASKS
    const result = router.routeCommand('explain');
    expect(result.type).toBe('model');
    if (result.type === 'model') {
      expect(result.model.name).toBe('sonnet');
    }
  });

  it('should get summarize model', () => {
    const model = router.getSummarizeModel();
    expect(model.name).toBe('haiku');
  });

  it('should get primary model from fallback chain', () => {
    const model = router.getPrimaryModel();
    expect(model.name).toBe('sonnet');
  });

  it('should get task type for commands', () => {
    expect(router.getCommandTask('commit')).toBe('fast');
    expect(router.getCommandTask('fix')).toBe('complex');
    expect(router.getCommandTask('explain')).toBe('code'); // From defaults
  });

  it('should check if command has pipeline', () => {
    expect(router.commandHasPipeline('commit')).toBe(false);
  });
});

describe('Model Map - Router with Pipelines', () => {
  const configWithPipelines: ModelMapConfig = {
    version: '1',
    models: {
      haiku: { provider: 'ollama', model: 'llama3.2' },
      sonnet: { provider: 'ollama', model: 'llama3.2' },
    },
    tasks: {
      code: { model: 'sonnet' },
    },
    commands: {
      refactor: { pipeline: 'smart-refactor' },
    },
    pipelines: {
      'smart-refactor': {
        description: 'Smart refactoring pipeline',
        steps: [
          { name: 'analyze', model: 'haiku', prompt: 'Analyze: {input}', output: 'analysis' },
          { name: 'implement', model: 'sonnet', prompt: 'Implement: {analysis}', output: 'result' },
        ],
        result: '{result}',
      },
    },
    fallbacks: {
      primary: ['sonnet'],
    },
  };

  it('should route command to pipeline', () => {
    const registry = new ModelRegistry(configWithPipelines);
    const router = new TaskRouter(configWithPipelines, registry);

    const result = router.routeCommand('refactor');
    expect(result.type).toBe('pipeline');
    if (result.type === 'pipeline') {
      expect(result.pipelineName).toBe('smart-refactor');
      expect(result.pipeline.steps).toHaveLength(2);
    }
  });

  it('should check if command has pipeline', () => {
    const registry = new ModelRegistry(configWithPipelines);
    const router = new TaskRouter(configWithPipelines, registry);

    expect(router.commandHasPipeline('refactor')).toBe(true);
    expect(router.commandHasPipeline('commit')).toBe(false);
  });

  it('should get pipeline by name', () => {
    const registry = new ModelRegistry(configWithPipelines);
    const router = new TaskRouter(configWithPipelines, registry);

    const pipeline = router.getPipeline('smart-refactor');
    expect(pipeline).toBeDefined();
    expect(pipeline?.steps).toHaveLength(2);
  });

  it('should list pipeline names', () => {
    const registry = new ModelRegistry(configWithPipelines);
    const router = new TaskRouter(configWithPipelines, registry);

    const names = router.getPipelineNames();
    expect(names).toContain('smart-refactor');
  });
});

describe('Model Map - Integration', () => {
  let tempDir: string;
  const globalConfigPath = path.join(os.homedir(), '.codi', 'models.yaml');
  const hasGlobalConfig = fs.existsSync(globalConfigPath);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codi-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null when no config file exists and no global config', () => {
    // If global config exists, this test becomes irrelevant
    if (hasGlobalConfig) {
      // When global config exists, initModelMap returns that config
      const modelMap = initModelMap(tempDir);
      expect(modelMap).not.toBeNull();
      modelMap?.shutdown();
    } else {
      const modelMap = initModelMap(tempDir);
      expect(modelMap).toBeNull();
    }
  });

  it('should initialize complete model map from valid config', () => {
    const yaml = `
version: "1"
models:
  haiku:
    provider: ollama
    model: llama3.2
    description: Fast model
  sonnet:
    provider: ollama
    model: llama3.2
    description: Code model
tasks:
  fast:
    model: haiku
  code:
    model: sonnet
fallbacks:
  primary: [sonnet, haiku]
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), yaml);

    const modelMap = initModelMap(tempDir);
    expect(modelMap).not.toBeNull();
    expect(modelMap?.config.models.haiku).toBeDefined();
    expect(modelMap?.registry).toBeDefined();
    expect(modelMap?.router).toBeDefined();
    expect(modelMap?.executor).toBeDefined();

    // Cleanup
    modelMap?.shutdown();
  });

  it('should return null for invalid project config (when no global config)', () => {
    // Config with validation errors
    const yaml = `
version: "1"
models: {}
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), yaml);

    // Suppress console output during test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const modelMap = initModelMap(tempDir);
    consoleSpy.mockRestore();

    if (hasGlobalConfig) {
      // When global config exists, it merges with invalid project config
      // The result depends on how merge handles the empty models
      // For this test, we just verify it doesn't crash
      modelMap?.shutdown();
    } else {
      expect(modelMap).toBeNull();
    }
  });

  it('should support config reload', () => {
    const yaml = `
version: "1"
models:
  haiku:
    provider: ollama
    model: llama3.2
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), yaml);

    const modelMap = initModelMap(tempDir);
    expect(modelMap).not.toBeNull();

    // Modify config
    const newYaml = `
version: "1"
models:
  haiku:
    provider: ollama
    model: llama3.2
  sonnet:
    provider: ollama
    model: llama3.2
`;
    fs.writeFileSync(path.join(tempDir, 'codi-models.yaml'), newYaml);

    // Reload
    const reloaded = modelMap?.reload();
    expect(reloaded).toBe(true);

    // Cleanup
    modelMap?.shutdown();
  });
});
