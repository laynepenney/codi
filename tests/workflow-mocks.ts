// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

// Mock provider implementation for workflow testing
import { vi } from 'vitest';

export type MockProviderResponse = {
  response: string;
  model: string;
  provider: string;
  mockDelay?: number;
};

export class MockProvider {
  name: string;
  model: string;
  responses: Map<string, MockProviderResponse>;

  constructor(name: string, model: string) {
    this.name = name;
    this.model = model;
    this.responses = new Map();
    this.setupDefaultResponses();
  }

  // Provider interface methods (required by workflow engine)
  getName(): string {
    return this.name;
  }

  getModel(): string {
    return this.model;
  }

  async streamChat(messages: any[], options: any = {}, callbacks: any = {}) {
    const response = await this.generateResponse(
      messages.map(m => m.content).join(' '),
      options.model || this.model
    );

    if (callbacks.onText) {
      const chunks = response.split(' ');
      for (const chunk of chunks) {
        callbacks.onText(chunk + ' ');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }

    return {
      response,
      usage: { inputTokens: 50, outputTokens: 150, totalTokens: 200 }
    };
  }

  async generateResponse(input: string, modelOverride?: string): Promise<string> {
    const model = modelOverride || this.model;
    const key = `${this.name}:${model}`;
    const response = this.responses.get(key);

    if (!response) {
      throw new Error(`No mock response configured for ${key}`);
    }

    if (response.mockDelay) {
      await new Promise(resolve => setTimeout(resolve, response.mockDelay));
    }

    return response.response;
  }

  setupDefaultResponses() {
    const providerResponses = {
      'anthropic': {
        'claude-3-5-haiku-latest': {
          response: "I've completed a quick review of the code. The syntax looks correct and the structure is clean.",
          model: 'claude-3-5-haiku-latest',
          provider: 'anthropic'
        },
        'claude-sonnet-4-20250514': {
          response: "## Detailed Analysis\n\n### Architecture\n- Design follows good patterns\n- Error handling could be improved\n\n### Security\n- Input validation adequate\n\n### Recommendations\n- Add test coverage\n- Implement logging",
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic'
        },
        'claude-3-5-haiku-latest-pr-analysis': {
          response: "## PR Analysis\n\n**Scope**: Medium - affects 3 files\n**Risk**: Low\n**Testing**: 85% coverage",
          model: 'claude-3-5-haiku-latest',
          provider: 'anthropic'
        },
        'claude-sonnet-4-20250514-pr-review': {
          response: "## PR Review\n\n### Code Quality\n- ✅ Good naming\n- ✅ Proper error handling\n\n### Recommendations\n1. Add input validation\n2. Add edge case tests",
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic'
        }
      },
      'openai': {
        'gpt-4o': {
          response: "## Alternative Perspective\n\n### Findings\n- Authentication uses outdated patterns\n- Consider modern practices\n\n### Modernization\n- Suggest GraphQL adoption\n- Consider micro-frontend architecture",
          model: 'gpt-4o',
          provider: 'openai'
        },
        'gpt-4o-pr-perspective': {
          response: "## PR Perspective\n\n### Modern Approaches\n- React Query for state\n- ESLint strict mode\n\n### UX Improvements\n- Better loading states\n- User-friendly errors",
          model: 'gpt-4o',
          provider: 'openai'
        }
      },
      'ollama': {
        'llama3.2': {
          response: "## Synthesis\n\n### Critical Issues\n1. Security: Token validation needed\n2. Performance: Database indexes\n\n### Improvements\n1. Dependency injection\n2. Error boundaries",
          model: 'llama3.2',
          provider: 'ollama'
        },
        'llama3.2-pr-synthesis': {
          response: "## PR Synthesis\n\n### Approval: APPROVED WITH COMMENTS\n\n### Critical Actions\n- Add input validation\n- Implement error boundaries\n\n### Recommended\n- Increase test coverage\n- Improve documentation",
          model: 'llama3.2',
          provider: 'ollama'
        }
      }
    };

    for (const [providerKey, models] of Object.entries(providerResponses)) {
      for (const [modelKey, response] of Object.entries(models)) {
        const key = `${providerKey}:${modelKey}`;
        this.responses.set(key, response);
      }
    }
  }
}

// Mock agent with configurable providers
export const createMockAgent = (providers: MockProvider[] = []) => {
  const providerMap = new Map<MockProvider, string>();
  providers.forEach(provider => {
    providerMap.set(`${provider.name}:${provider.model}`, provider);
  });

  // Enhanced mock agent with full workflow execution support
  const agent = {
    // State tracking
    provider: providers[0],
    currentModel: providers[0]?.model || 'claude-sonnet-4-20250514',
    currentProviderName: providers[0]?.name || 'anthropic',

    // Execute shell commands
    executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
      if (toolName === 'bash') {
        return { stdout: 'mock shell output', stderr: '', exitCode: 0 };
      }
      return { result: 'mock tool result' };
    }),

    // AI chat function for workflow AI prompt steps (returns in expected format)
    chat: vi.fn().mockImplementation(async (prompt: string, options?: any) => {
      const provider = agent.provider as MockProvider;
      const model = options?.model || agent.currentModel;

      const response = await provider.generateResponse(prompt, model);

      // Return in the format expected by workflow executor
      return {
        text: response,
        response: response
      };
    }),

    // Switch model for workflow model switching
    switchModel: vi.fn().mockImplementation(async (model: string) => {
      const [providerName, modelName] = model.includes(':')
        ? model.split(':', 2)
        : [agent.currentProviderName, model];

      const provider = providerMap.get(`${providerName}:${modelName}`) || providers[0];

      // Update agent state
      agent.provider = provider;
      agent.currentProviderName = providerName;
      agent.currentModel = modelName;

      return provider;
    }),

    // Execute workflow steps with full simulation
    executeStep: vi.fn().mockImplementation(async (stepInfo: any) => {
      const step = stepInfo;

      try {
        switch (step.action) {
          case 'shell':
            return await agent.executeTool('bash', {
              command: step.command || step.prompt
            });

          case 'ai-prompt':
            const response = await agent.chat(
              step.prompt,
              { model: step.model }
            );
            return { status: 'completed', result: response };

          case 'switch-model':
            const newProvider = await agent.switchModel(step.model);
            return { status: 'completed', result: `Switched to ${newProvider.getModel()}` };

          case 'interactive':
            return { status: 'completed', result: `Interactive step "${step.id}" completed` };

          case 'create-pr':
          case 'merge-pr':
            return { status: 'completed', result: `PR operation "${step.action}" simulated` };

          default:
            return { status: 'completed', result: `Executed ${step.action}: ${step.id}` };
        }
      } catch (error) {
        return {
          status: 'failed',
          result: error instanceof Error ? error.message : String(error)
        };
      }
    }),

    // Get current provider
    getProvider: vi.fn().mockImplementation(() => {
      return agent.provider;
    }),

    // Callbacks
    callbacks: {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue({ approved: true }),
      onReasoning: vi.fn(),
      onReasoningChunk: vi.fn(),
      onCompaction: vi.fn(),
      onProviderChange: vi.fn()
    }
  };

  return agent;
};