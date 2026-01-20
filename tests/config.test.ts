// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadWorkspaceConfig,
  validateConfig,
  mergeConfig,
  shouldAutoApprove,
  getCustomDangerousPatterns,
  getExampleConfig,
  initConfig,
  type WorkspaceConfig,
  type ResolvedConfig,
} from '../src/config';

// Use a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), '.codi-config-test');

describe('Workspace Configuration', () => {
  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('loadWorkspaceConfig', () => {
    it('returns null when no config file exists', () => {
      const { config, configPath } = loadWorkspaceConfig(TEST_DIR);
      expect(config).toBeNull();
      expect(configPath).toBeNull();
    });

    it('loads .codi.json config file', () => {
      const testConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3',
        autoApprove: ['read_file'],
      };
      fs.writeFileSync(
        path.join(TEST_DIR, '.codi.json'),
        JSON.stringify(testConfig)
      );

      const { config, configPath } = loadWorkspaceConfig(TEST_DIR);
      expect(config).toEqual(testConfig);
      expect(configPath).toBe(path.join(TEST_DIR, '.codi.json'));
    });

    it('loads .codi/config.json config file', () => {
      fs.mkdirSync(path.join(TEST_DIR, '.codi'));
      const testConfig: WorkspaceConfig = {
        provider: 'openai',
      };
      fs.writeFileSync(
        path.join(TEST_DIR, '.codi/config.json'),
        JSON.stringify(testConfig)
      );

      const { config, configPath } = loadWorkspaceConfig(TEST_DIR);
      expect(config).toEqual(testConfig);
      expect(configPath).toBe(path.join(TEST_DIR, '.codi/config.json'));
    });

    it('loads codi.config.json config file', () => {
      const testConfig: WorkspaceConfig = {
        provider: 'ollama',
        model: 'llama2',
      };
      fs.writeFileSync(
        path.join(TEST_DIR, 'codi.config.json'),
        JSON.stringify(testConfig)
      );

      const { config, configPath } = loadWorkspaceConfig(TEST_DIR);
      expect(config).toEqual(testConfig);
      expect(configPath).toBe(path.join(TEST_DIR, 'codi.config.json'));
    });

    it('prioritizes .codi.json over other config files', () => {
      // Create both config files
      fs.writeFileSync(
        path.join(TEST_DIR, '.codi.json'),
        JSON.stringify({ provider: 'anthropic' })
      );
      fs.writeFileSync(
        path.join(TEST_DIR, 'codi.config.json'),
        JSON.stringify({ provider: 'openai' })
      );

      const { config } = loadWorkspaceConfig(TEST_DIR);
      expect(config?.provider).toBe('anthropic');
    });

    it('handles invalid JSON gracefully', () => {
      fs.writeFileSync(
        path.join(TEST_DIR, '.codi.json'),
        'not valid json {'
      );

      const { config, configPath } = loadWorkspaceConfig(TEST_DIR);
      expect(config).toBeNull();
      expect(configPath).toBe(path.join(TEST_DIR, '.codi.json'));
    });
  });

  describe('validateConfig', () => {
    it('returns no warnings for valid config', () => {
      const config: WorkspaceConfig = {
        provider: 'anthropic',
        autoApprove: ['read_file', 'glob'],
        dangerousPatterns: ['rm -rf'],
      };

      const warnings = validateConfig(config);
      expect(warnings).toEqual([]);
    });

    it('warns about unknown provider', () => {
      const config: WorkspaceConfig = {
        provider: 'unknown-provider',
      };

      const warnings = validateConfig(config);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Unknown provider');
    });

    it('warns about unknown tools in autoApprove', () => {
      const config: WorkspaceConfig = {
        autoApprove: ['read_file', 'unknown_tool'],
      };

      const warnings = validateConfig(config);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('unknown_tool');
    });

    it('warns about invalid regex in dangerousPatterns', () => {
      const config: WorkspaceConfig = {
        dangerousPatterns: ['[invalid(regex'],
      };

      const warnings = validateConfig(config);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Invalid regex');
    });

    it('warns about command aliases not starting with /', () => {
      const config: WorkspaceConfig = {
        commandAliases: {
          t: 'test',  // Should be '/test'
        },
      };

      const warnings = validateConfig(config);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('should start with "/"');
    });
  });

  describe('mergeConfig', () => {
    it('uses defaults when no config provided', () => {
      const resolved = mergeConfig(null, {});

      expect(resolved.provider).toBe('auto');
      expect(resolved.autoApprove).toEqual([]);
      expect(resolved.noTools).toBe(false);
    });

    it('applies workspace config', () => {
      const workspaceConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3',
        autoApprove: ['read_file'],
        projectContext: 'Test project',
      };

      const resolved = mergeConfig(workspaceConfig, {});

      expect(resolved.provider).toBe('anthropic');
      expect(resolved.model).toBe('claude-3');
      expect(resolved.autoApprove).toEqual(['read_file']);
      expect(resolved.projectContext).toBe('Test project');
    });

    it('CLI options override workspace config', () => {
      const workspaceConfig: WorkspaceConfig = {
        provider: 'anthropic',
        model: 'claude-3',
      };

      const resolved = mergeConfig(workspaceConfig, {
        provider: 'openai',
        model: 'gpt-4',
      });

      expect(resolved.provider).toBe('openai');
      expect(resolved.model).toBe('gpt-4');
    });

    it('--yes flag overrides autoApprove with all tools', () => {
      const workspaceConfig: WorkspaceConfig = {
        autoApprove: ['read_file'],
      };

      const resolved = mergeConfig(workspaceConfig, { yes: true });

      expect(resolved.autoApprove).toContain('bash');
      expect(resolved.autoApprove).toContain('write_file');
      expect(resolved.autoApprove).toContain('edit_file');
    });

    it('--no-tools flag sets noTools to true', () => {
      const resolved = mergeConfig(null, { tools: false });

      expect(resolved.noTools).toBe(true);
    });
  });

  describe('shouldAutoApprove', () => {
    it('returns true for tools in autoApprove list', () => {
      const config: ResolvedConfig = {
        provider: 'auto',
        autoApprove: ['read_file', 'glob'],
        dangerousPatterns: [],
        noTools: false,
        commandAliases: {},
      };

      expect(shouldAutoApprove('read_file', config)).toBe(true);
      expect(shouldAutoApprove('glob', config)).toBe(true);
    });

    it('returns false for tools not in autoApprove list', () => {
      const config: ResolvedConfig = {
        provider: 'auto',
        autoApprove: ['read_file'],
        dangerousPatterns: [],
        noTools: false,
        commandAliases: {},
      };

      expect(shouldAutoApprove('bash', config)).toBe(false);
      expect(shouldAutoApprove('write_file', config)).toBe(false);
    });
  });

  describe('getCustomDangerousPatterns', () => {
    it('returns empty array when no patterns configured', () => {
      const config: ResolvedConfig = {
        provider: 'auto',
        autoApprove: [],
        dangerousPatterns: [],
        noTools: false,
        commandAliases: {},
      };

      const patterns = getCustomDangerousPatterns(config);
      expect(patterns).toEqual([]);
    });

    it('converts string patterns to RegExp', () => {
      const config: ResolvedConfig = {
        provider: 'auto',
        autoApprove: [],
        dangerousPatterns: ['rm -rf', 'sudo.*'],
        noTools: false,
        commandAliases: {},
      };

      const patterns = getCustomDangerousPatterns(config);
      expect(patterns.length).toBe(2);
      expect(patterns[0].pattern.test('rm -rf /')).toBe(true);
      expect(patterns[1].pattern.test('sudo apt install')).toBe(true);
    });
  });

  describe('getExampleConfig', () => {
    it('returns valid JSON', () => {
      const example = getExampleConfig();
      expect(() => JSON.parse(example)).not.toThrow();
    });

    it('includes key config options', () => {
      const example = JSON.parse(getExampleConfig());
      expect(example).toHaveProperty('provider');
      expect(example).toHaveProperty('model');
      expect(example).toHaveProperty('autoApprove');
      expect(example).toHaveProperty('commandAliases');
    });
  });

  describe('initConfig', () => {
    it('creates .codi.json file', () => {
      const result = initConfig(TEST_DIR);

      expect(result.success).toBe(true);
      expect(result.path).toBe(path.join(TEST_DIR, '.codi.json'));
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('returns error if config already exists', () => {
      // Create existing config
      fs.writeFileSync(
        path.join(TEST_DIR, '.codi.json'),
        JSON.stringify({ provider: 'existing' })
      );

      const result = initConfig(TEST_DIR);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('created config is valid JSON', () => {
      initConfig(TEST_DIR);

      const content = fs.readFileSync(
        path.join(TEST_DIR, '.codi.json'),
        'utf-8'
      );
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });
});
