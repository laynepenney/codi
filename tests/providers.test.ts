import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseProvider } from '../src/providers/base.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider, createRunPodProvider } from '../src/providers/openai-compatible.js';
import {
  createProvider,
  registerProviderFactory,
  getProviderTypes,
  hasProviderType,
} from '../src/providers/index.js';
import type { Message, ContentBlock } from '../src/types.js';

// Mock the SDK clients
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('BaseProvider', () => {
  // Create a concrete implementation for testing
  class TestProvider extends BaseProvider {
    async chat() {
      return { content: '', toolCalls: [], stopReason: 'end_turn' as const };
    }
    async streamChat() {
      return { content: '', toolCalls: [], stopReason: 'end_turn' as const };
    }
    supportsToolUse() { return true; }
    getName() { return 'Test'; }
    getModel() { return 'test-model'; }
  }

  it('supportsVision returns false by default', () => {
    const provider = new TestProvider();
    expect(provider.supportsVision()).toBe(false);
  });
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  describe('supportsVision', () => {
    it('returns true for claude-3 models', () => {
      const provider3 = new AnthropicProvider({ apiKey: 'test', model: 'claude-3-opus-20240229' });
      expect(provider3.supportsVision()).toBe(true);
    });

    it('returns true for claude-sonnet-4 models', () => {
      const provider4 = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' });
      expect(provider4.supportsVision()).toBe(true);
    });

    it('returns true for claude-opus-4 models', () => {
      const providerOpus = new AnthropicProvider({ apiKey: 'test', model: 'claude-opus-4-20250514' });
      expect(providerOpus.supportsVision()).toBe(true);
    });

    it('returns false for claude-2 models', () => {
      const provider2 = new AnthropicProvider({ apiKey: 'test', model: 'claude-2.1' });
      expect(provider2.supportsVision()).toBe(false);
    });
  });

  describe('supportsToolUse', () => {
    it('returns true', () => {
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('getName', () => {
    it('returns Anthropic', () => {
      expect(provider.getName()).toBe('Anthropic');
    });
  });

  describe('getModel', () => {
    it('returns the configured model', () => {
      const customProvider = new AnthropicProvider({ model: 'custom-model' });
      expect(customProvider.getModel()).toBe('custom-model');
    });

    it('returns default model when not specified', () => {
      expect(provider.getModel()).toContain('claude');
    });
  });
});

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({ apiKey: 'test-key' });
  });

  describe('supportsVision', () => {
    it('returns true for gpt-4 models', () => {
      const provider4 = new OpenAICompatibleProvider({ model: 'gpt-4-turbo' });
      expect(provider4.supportsVision()).toBe(true);
    });

    it('returns true for gpt-4o models', () => {
      const provider4o = new OpenAICompatibleProvider({ model: 'gpt-4o' });
      expect(provider4o.supportsVision()).toBe(true);
    });

    it('returns true for gpt-5 models', () => {
      const provider5 = new OpenAICompatibleProvider({ model: 'gpt-5' });
      expect(provider5.supportsVision()).toBe(true);
    });

    it('returns true for models with vision in name', () => {
      const visionProvider = new OpenAICompatibleProvider({ model: 'llava-vision' });
      expect(visionProvider.supportsVision()).toBe(true);
    });

    it('returns false for gpt-3.5 models', () => {
      const provider35 = new OpenAICompatibleProvider({ model: 'gpt-3.5-turbo' });
      expect(provider35.supportsVision()).toBe(false);
    });
  });

  describe('supportsToolUse', () => {
    it('returns true', () => {
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('getName', () => {
    it('returns OpenAI by default', () => {
      expect(provider.getName()).toBe('OpenAI');
    });

    it('returns custom provider name', () => {
      const customProvider = new OpenAICompatibleProvider({ providerName: 'Custom' } as any);
      expect(customProvider.getName()).toBe('Custom');
    });
  });

  describe('getModel', () => {
    it('returns the configured model', () => {
      const customProvider = new OpenAICompatibleProvider({ model: 'custom-model' });
      expect(customProvider.getModel()).toBe('custom-model');
    });
  });
});

describe('createOllamaProvider', () => {
  it('creates provider with default model', () => {
    const provider = createOllamaProvider();
    expect(provider.getName()).toBe('Ollama');
    expect(provider.getModel()).toBe('llama3.2');
  });

  it('creates provider with custom model', () => {
    const provider = createOllamaProvider('mistral');
    expect(provider.getModel()).toBe('mistral');
  });
});

describe('createRunPodProvider', () => {
  beforeEach(() => {
    process.env.RUNPOD_API_KEY = 'test-key';
  });

  it('throws error when API key is missing', () => {
    delete process.env.RUNPOD_API_KEY;
    expect(() => createRunPodProvider('endpoint-id', 'model'))
      .toThrow('RunPod API key required');
  });

  it('throws error when endpoint ID is missing', () => {
    expect(() => createRunPodProvider('', 'model'))
      .toThrow('RunPod endpoint ID required');
  });

  it('creates provider with valid config', () => {
    const provider = createRunPodProvider('test-endpoint', 'test-model', 'test-key');
    expect(provider.getName()).toBe('RunPod');
    expect(provider.getModel()).toBe('test-model');
  });
});

describe('Provider Factory', () => {
  describe('getProviderTypes', () => {
    it('returns list of registered provider types', () => {
      const types = getProviderTypes();
      expect(types).toContain('anthropic');
      expect(types).toContain('openai');
      expect(types).toContain('ollama');
      expect(types).toContain('runpod');
    });
  });

  describe('hasProviderType', () => {
    it('returns true for registered types', () => {
      expect(hasProviderType('anthropic')).toBe(true);
      expect(hasProviderType('openai')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(hasProviderType('unknown-provider')).toBe(false);
    });
  });

  describe('createProvider', () => {
    it('creates anthropic provider', () => {
      const provider = createProvider({ type: 'anthropic', apiKey: 'test' });
      expect(provider.getName()).toBe('Anthropic');
    });

    it('creates openai provider', () => {
      const provider = createProvider({ type: 'openai', apiKey: 'test' });
      expect(provider.getName()).toBe('OpenAI');
    });

    it('creates ollama provider', () => {
      const provider = createProvider({ type: 'ollama', model: 'llama3' });
      expect(provider.getName()).toBe('Ollama');
    });

    it('throws error for unknown provider type', () => {
      expect(() => createProvider({ type: 'unknown' }))
        .toThrow('Unknown provider type: unknown');
    });
  });

  describe('registerProviderFactory', () => {
    it('throws error when registering duplicate type', () => {
      expect(() => registerProviderFactory('anthropic', () => null as any))
        .toThrow("Provider type 'anthropic' is already registered");
    });
  });
});

describe('Message Conversion with Images', () => {
  // Test that image blocks are properly handled in message conversion
  // We test this indirectly through the provider structure

  it('ContentBlock type supports image', () => {
    const imageBlock: ContentBlock = {
      type: 'image',
      image: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    };
    expect(imageBlock.type).toBe('image');
    expect(imageBlock.image?.media_type).toBe('image/png');
  });

  it('Message can contain image blocks', () => {
    const message: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          image: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: '/9j/4AAQSkZJRg==',
          },
        },
      ],
    };
    expect(message.content).toHaveLength(2);
    expect((message.content as ContentBlock[])[1].type).toBe('image');
  });
});
