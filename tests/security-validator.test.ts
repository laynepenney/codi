// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SecurityValidator,
  createSecurityValidator,
  type SecurityValidatorConfig,
} from '../src/security-validator.js';

describe('SecurityValidator', () => {
  describe('createSecurityValidator', () => {
    it('should create a validator with default config', () => {
      const validator = createSecurityValidator();
      const config = validator.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.model).toBe('llama3.2');
      expect(config.blockThreshold).toBe(8);
      expect(config.warnThreshold).toBe(5);
      expect(config.tools).toEqual(['bash']);
      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.timeout).toBe(10000);
    });

    it('should create a validator with custom config', () => {
      const validator = createSecurityValidator({
        enabled: true,
        model: 'qwen3:8b',
        blockThreshold: 7,
        warnThreshold: 4,
        tools: ['bash', 'write_file'],
        timeout: 5000,
      });
      const config = validator.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.model).toBe('qwen3:8b');
      expect(config.blockThreshold).toBe(7);
      expect(config.warnThreshold).toBe(4);
      expect(config.tools).toEqual(['bash', 'write_file']);
      expect(config.timeout).toBe(5000);
    });
  });

  describe('shouldValidate', () => {
    it('should return false when disabled', () => {
      const validator = createSecurityValidator({ enabled: false });
      expect(validator.shouldValidate('bash')).toBe(false);
    });

    it('should return true for bash when enabled', () => {
      const validator = createSecurityValidator({ enabled: true });
      expect(validator.shouldValidate('bash')).toBe(true);
    });

    it('should return false for tools not in the list', () => {
      const validator = createSecurityValidator({ enabled: true, tools: ['bash'] });
      expect(validator.shouldValidate('write_file')).toBe(false);
    });

    it('should return true for custom tools in the list', () => {
      const validator = createSecurityValidator({ enabled: true, tools: ['bash', 'write_file'] });
      expect(validator.shouldValidate('write_file')).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return false when disabled', () => {
      const validator = createSecurityValidator({ enabled: false });
      expect(validator.isEnabled()).toBe(false);
    });

    it('should return true when enabled', () => {
      const validator = createSecurityValidator({ enabled: true });
      expect(validator.isEnabled()).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const validator = createSecurityValidator({ enabled: false });
      expect(validator.isEnabled()).toBe(false);

      validator.updateConfig({ enabled: true, model: 'mistral' });
      const config = validator.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.model).toBe('mistral');
    });
  });

  describe('validate', () => {
    it('should allow when validation is disabled', async () => {
      const validator = createSecurityValidator({ enabled: false });
      const result = await validator.validate({
        id: 'test-1',
        name: 'bash',
        input: { command: 'rm -rf /' },
      });

      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
      expect(result.recommendation).toBe('allow');
      expect(result.reasoning).toContain('not enabled');
    });

    it('should allow when tool is not in the validation list', async () => {
      const validator = createSecurityValidator({ enabled: true, tools: ['write_file'] });
      const result = await validator.validate({
        id: 'test-2',
        name: 'bash',
        input: { command: 'ls -la' },
      });

      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
      expect(result.recommendation).toBe('allow');
    });

    it('should allow when command is empty', async () => {
      const validator = createSecurityValidator({ enabled: true });
      const result = await validator.validate({
        id: 'test-3',
        name: 'bash',
        input: { command: '' },
      });

      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
    });

    it('should allow when ollama is not available', async () => {
      const validator = createSecurityValidator({
        enabled: true,
        baseUrl: 'http://localhost:99999', // Non-existent port
        timeout: 1000,
      });

      const result = await validator.validate({
        id: 'test-4',
        name: 'bash',
        input: { command: 'rm -rf /' },
      });

      expect(result.allowed).toBe(true);
      expect(result.recommendation).toBe('allow');
      expect(result.reasoning).toContain('not available');
    });
  });

  describe('checkAvailability', () => {
    it('should return false when ollama is not running', async () => {
      const validator = createSecurityValidator({
        baseUrl: 'http://localhost:99999',
      });

      const available = await validator.checkAvailability();
      expect(available).toBe(false);
    });
  });
});
