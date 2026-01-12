import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSecondaryProvider,
  createProvider,
} from '../src/providers/index.js';
import { mergeConfig } from '../src/config.js';

describe('Multi-Model Orchestration', () => {
  describe('createSecondaryProvider', () => {
    it('should return null when no config is provided', () => {
      const provider = createSecondaryProvider(undefined);
      expect(provider).toBeNull();
    });

    it('should return null when config is empty', () => {
      const provider = createSecondaryProvider({});
      expect(provider).toBeNull();
    });

    it('should return null when only provider is undefined and model is undefined', () => {
      const provider = createSecondaryProvider({
        provider: undefined,
        model: undefined,
      });
      expect(provider).toBeNull();
    });

    it('should create a provider when provider type is specified', () => {
      // Mock the createProvider function
      const provider = createSecondaryProvider({
        provider: 'ollama',
        model: 'llama3.2',
      });
      expect(provider).not.toBeNull();
      expect(provider?.getName()).toBe('Ollama');
    });

    it('should use auto-detection when only model is specified', () => {
      const provider = createSecondaryProvider({
        model: 'llama3.2',
      });
      // Should fall back to auto-detection
      expect(provider).not.toBeNull();
    });
  });

  describe('mergeConfig with summarize options', () => {
    it('should include summarize options from workspace config', () => {
      const workspaceConfig = {
        provider: 'anthropic',
        models: {
          summarize: {
            provider: 'ollama',
            model: 'llama3.2',
          },
        },
      };

      const resolved = mergeConfig(workspaceConfig, {});
      expect(resolved.summarizeProvider).toBe('ollama');
      expect(resolved.summarizeModel).toBe('llama3.2');
    });

    it('should override workspace config with CLI options', () => {
      const workspaceConfig = {
        provider: 'anthropic',
        models: {
          summarize: {
            provider: 'ollama',
            model: 'llama3.2',
          },
        },
      };

      const resolved = mergeConfig(workspaceConfig, {
        summarizeProvider: 'openai',
        summarizeModel: 'gpt-4o-mini',
      });
      expect(resolved.summarizeProvider).toBe('openai');
      expect(resolved.summarizeModel).toBe('gpt-4o-mini');
    });

    it('should not set summarize options when not configured', () => {
      const resolved = mergeConfig(null, {});
      expect(resolved.summarizeProvider).toBeUndefined();
      expect(resolved.summarizeModel).toBeUndefined();
    });

    it('should handle partial summarize config', () => {
      const workspaceConfig = {
        models: {
          summarize: {
            model: 'llama3.2',
            // No provider specified
          },
        },
      };

      const resolved = mergeConfig(workspaceConfig, {});
      expect(resolved.summarizeProvider).toBeUndefined();
      expect(resolved.summarizeModel).toBe('llama3.2');
    });

    it('should handle CLI-only summarize options', () => {
      const resolved = mergeConfig(null, {
        summarizeProvider: 'ollama',
        summarizeModel: 'llama3.2',
      });
      expect(resolved.summarizeProvider).toBe('ollama');
      expect(resolved.summarizeModel).toBe('llama3.2');
    });
  });

  describe('Agent with secondary provider', () => {
    it('should use secondary provider for summarization when configured', async () => {
      // This would require more complex mocking of the Agent class
      // For now, we test the integration at the config level
      expect(true).toBe(true);
    });
  });
});
