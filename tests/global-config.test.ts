// Tests for global config functionality

import {
  loadGlobalConfig,
  getGlobalConfigDir,
  mergeConfig,
  type WorkspaceConfig,
  type ResolvedConfig,
} from '../src/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const GLOBAL_DIR = path.join(os.tmpdir(), '.codi-test-global');
const GLOBAL_FILE = path.join(GLOBAL_DIR, 'config.json');

describe('Global Configuration', () => {
  beforeEach(() => {
    // Clean up any existing global config
    if (fs.existsSync(GLOBAL_DIR)) {
      fs.rmSync(GLOBAL_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test global config
    if (fs.existsSync(GLOBAL_DIR)) {
      fs.rmSync(GLOBAL_DIR, { recursive: true });
    }
  });

  describe('loadGlobalConfig', () => {
    it('returns null when global config file does not exist', () => {
      // Create directory but not file
      if (!fs.existsSync(GLOBAL_DIR)) {
        fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      }

      const { config, configPath } = loadGlobalConfig(GLOBAL_DIR);
      expect(config).toBeNull();
    });

    it('loads and parses valid global config file', () => {
      const testConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        autoApprove: ['read_file', 'grep'],
      };

      fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      fs.writeFileSync(GLOBAL_FILE, JSON.stringify(testConfig, null, 2));

      const { config, configPath } = loadGlobalConfig(GLOBAL_DIR);
      expect(config).toEqual(testConfig);
      expect(configPath).toBe(GLOBAL_FILE);
    });

    it('returns null and warns on invalid JSON', () => {
      fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      fs.writeFileSync(GLOBAL_FILE, '{ invalid json }');

      const { config, configPath } = loadGlobalConfig(GLOBAL_DIR);
      expect(config).toBeNull();
      expect(configPath).toBe(GLOBAL_FILE);
    });

    it('handles empty config file', () => {
      fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      fs.writeFileSync(GLOBAL_FILE, '{}');

      const { config } = loadGlobalConfig(GLOBAL_DIR);
      expect(config).not.toBeNull();
      expect(config).toEqual({});
    });
  });

  describe('getGlobalConfigDir', () => {
    it('returns the correct global config directory path', () => {
      const dir = getGlobalConfigDir();
      expect(dir).toContain('.codi');
      expect(dir).toBe(path.join(os.homedir(), '.codi'));
    });
  });

  describe('Config Priority with Global Config', () => {
    it('applies global config when no workspace config exists', () => {
      const globalConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama3.2',
        autoApprove: ['read_file'],
      };

      const result = mergeConfig(
        null, // No workspace config
        {}, // Empty CLI options
        null, // No local config
        globalConfig
      );

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('llama3.2');
      expect(result.autoApprove).toEqual(['read_file']);
    });

    it('workspace config overrides global config', () => {
      const globalConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama3.2',
        autoApprove: ['read_file'],
      };

      const workspaceConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      };

      const result = mergeConfig(
        workspaceConfig,
        {}, // Empty CLI options
        null, // No local config
        globalConfig
      );

      // Workspace config should win
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-sonnet');
      // Global config provides fallback
      expect(result.autoApprove).toEqual(['read_file']);
    });

    it('CLI options override global config', () => {
      const globalConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama3.2',
      };

      const cliOptions = {
        provider: 'anthropic' as const,
      };

      const result = mergeConfig(
        null, // No workspace config
        cliOptions,
        null, // No local config
        globalConfig
      );

      expect(result.provider).toBe('anthropic'); // CLI wins
      expect(result.model).toBe('llama3.2'); // Global provides fallback
    });

    it('config priority: CLI > local > workspace > global', () => {
      const globalConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama3.2',
        autoApprove: ['read_file'],
      };

      const workspaceConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3-5-haiku',
        autoApprove: ['read_file', 'grep'],
      };

      const localConfig: WorkspaceConfig = {
        autoApprove: ['read_file', 'grep', 'list_directory'],
      };

      const cliOptions = {
        provider: 'openai' as const,
      };

      const result = mergeConfig(
        workspaceConfig,
        cliOptions,
        localConfig,
        globalConfig
      );

      // CLI wins for provider
      expect(result.provider).toBe('openai');
      // Local config wins for approvals
      expect(result.autoApprove).toEqual(['read_file', 'grep', 'list_directory']);
      // Workspace config provides model (not in CLI or local)
      expect(result.model).toBe('claude-3-5-haiku');
    });
  });

  describe('Global Config Features', () => {
    it('applies all global config properties correctly', () => {
      const globalConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama3.2',
        baseUrl: 'https://custom.ollama.com',
        endpointId: 'test-endpoint',
        autoApprove: ['read_file', 'grep'],
        approvedPatterns: ['safe-.*'],
        approvedCategories: ['info'],
        dangerousPatterns: [{ pattern: /danger/, description: 'Dangerous command', block: false }],
        systemPromptAdditions: 'Be helpful',
        noTools: true,
        extractToolsFromText: false,
        defaultSession: 'my-session',
        commandAliases: { t: '/test', b: '/build' },
        projectContext: 'This is a test project',
        enableCompression: true,
        maxContextTokens: 100000,
        cleanHallucinatedTraces: true,
        models: {
          summarize: {
            provider: 'ollama',
            model: 'llama3.2',
          },
        },
        tools: {
          disabled: ['bash'],
          defaults: { timeout: 30 },
        },
      };

      const result = mergeConfig(null, {}, null, globalConfig);

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('llama3.2');
      expect(result.baseUrl).toBe('https://custom.ollama.com');
      expect(result.endpointId).toBe('test-endpoint');
      expect(result.autoApprove).toEqual(['read_file', 'grep']);
      expect(result.approvedPatterns).toEqual(['safe-.*']);
      expect(result.approvedCategories).toEqual(['info']);
      expect(result.dangerousPatterns).toHaveLength(1);
      expect(result.systemPromptAdditions).toBe('Be helpful');
      expect(result.noTools).toBe(true);
      expect(result.extractToolsFromText).toBe(false);
      expect(result.defaultSession).toBe('my-session');
      expect(result.commandAliases).toEqual({ t: '/test', b: '/build' });
      expect(result.projectContext).toBe('This is a test project');
      expect(result.enableCompression).toBe(true);
      expect(result.maxContextTokens).toBe(100000);
      expect(result.cleanHallucinatedTraces).toBe(true);
      expect(result.summarizeProvider).toBe('ollama');
      expect(result.summarizeModel).toBe('llama3.2');
      expect(result.toolsConfig.disabled).toEqual(['bash']);
      expect(result.toolsConfig.defaults).toEqual({ timeout: 30 });
    });
  });
});