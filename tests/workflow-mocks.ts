// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

// Mock provider implementation for workflow testing
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

  setupDefaultResponses() {
    const providerResponses = {
      'anthropic': {
        'claude-3-5-haiku-latest': {
          response: "I've completed a quick review of the code. The syntax looks correct and the structure is clean. I spotted a few minor style issues but nothing critical. Overall, this code appears ready for deeper analysis.",
          model: 'claude-3-5-haiku-latest',
          provider: 'anthropic'
        },
        'claude-sonnet-4-20250514': {
          response: "## Detailed Analysis\n\nAfter thorough examination, I've identified several key areas:\n\n### Architecture\n- The design follows good patterns but lacks proper dependency injection\n- Error handling could be more comprehensive\n\n### Security\n- Input validation appears adequate\n- Authentication flow needs stronger token validation\n\n### Performance\n- Database queries could be optimized with indexes\n- Consider caching for frequently accessed data\n\n### Recommendations\n- Add more test coverage for edge cases\n- Implement proper logging throughout",
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic'
        },
        'claude-3-5-haiku-latest-pr-analysis': {
          response: "## PR Analysis\n\n**Scope**: Medium - affects 3 files\n**Risk**: Low - mostly refactoring\n**Testing**: Good coverage - 85%\n**Dependencies**: None added\n\nQuick assessment: Safe to proceed with detailed review.",
          model: 'claude-3-5-haiku-latest',
          provider: 'anthropic'
        },
        'claude-sonnet-4-20250514-pr-review': {
          response: "## Comprehensive PR Review\n\n### Code Quality\n- ✅ Good variable naming\n- ✅ Proper error handling patterns\n- ⚠️ Missing input validation in functions\n\n### Architecture\n- ✅ Follows existing patterns\n- ✅ Proper separation of concerns\n- ⚠️ Could benefit from dependency injection\n\n### Testing\n- ✅ Good test coverage (85%)\n- ⚠️ Missing edge case tests\n- ✅ Tests follow project conventions\n\n### Recommendations\n1. Add input validation to new functions\n2. Add edge case tests\n3. Consider dependency injection for better testability",
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic'
        }
      },
      'openai': {
        'gpt-4o': {
          response: "## Alternative Perspective Review\n\nLooking at this from a different angle:\n\n### Unique Findings\n- The authentication flow uses outdated session management\n- Consider implementing refresh tokens for better security\n- The UI state management could use Redux toolkit for scalability\n\n### Edge Cases\n- Need to handle network timeout scenarios\n- Race conditions possible in concurrent user scenarios\n\n### Modern Practices\n- Suggest adopting GraphQL for better type safety\n- Consider micro-frontend architecture for larger applications",
          model: 'gpt-4o',
          provider: 'openai'
        },
        'gpt-4o-pr-perspective': {
          response: "## Alternative PR Perspective\n\n### Modern Approaches\n- Consider using React Query for server state management\n- Could benefit from TypeScript strict mode\n- Consider using ESLint with stricter rules\n\n### User Experience\n- Loading states need better UX\n- Error messages could be more user-friendly\n- Consider adding loading skeletons\n\n### Performance\n- Bundle size has increased moderately\n- Consider code splitting for larger features\n- Optimize initial page load time",
          model: 'gpt-4o',
          provider: 'openai'
        }
      },
      'ollama': {
        'llama3.2': {
          response: "## Synthesis of All Reviews\n\n### Critical Issues (Must Fix)\n1. Security: Implement proper token validation\n2. Performance: Add database indexes on frequently queried fields\n\n### Important Improvements (Should Fix Soon)\n1. Architecture: Add dependency injection for testability\n2. Error Handling: Comprehensive error boundaries\n\n### Nice-to-Have Enhancements\n1. Modernization: Consider GraphQL adoption\n2. Testing: Increase edge case coverage\n\n### Estimated Effort\n- Critical: 2-3 days\n- Important: 1 week\n- Nice-to-Have: 2-3 weeks",
          model: 'llama3.2',
          provider: 'ollama'
        },
        'llama3.2-pr-synthesis': {
          response: "## PR Review Synthesis\n\n### Approval Status: APPROVED WITH COMMENTS\n\n### Critical Actions (Required)\n- Add input validation to new API endpoints\n- Implement proper error boundary handling\n\n### Recommended Improvements\n- Increase test coverage for edge cases\n- Add authentication middleware tests\n- Improve API documentation\n\n### Estimated Effort: 2-3 days\n\n### Overall Assessment\nSolid implementation with minor improvements needed. Ready for merge after addressing critical items.",
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

  async generateResponse(input: string, modelOverride?: string): Promise<string> {
    const model = modelOverride || this.model;
    const key = `${this.name}:${model}`;
    const response = this.responses.get(key);
    
    if (!response) {
      throw new Error(`No mock response configured for ${key}`);
    }

    // Simulate API delay
    if (response.mockDelay) {
      await new Promise(resolve => setTimeout(resolve, response.mockDelay));
    }

    return response.response;
  }

  async streamChat(messages: any[], options: any = {}, callbacks: any = {}) {
    const response = await this.generateResponse('', options.model);
    
    if (callbacks.onText) {
      // Simulate streaming
      const chunks = response.split(' ');
      for (const chunk of chunks) {
        callbacks.onText(chunk + ' ');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    return {
      response,
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 }
    };
  }
}

// Mock agent with configurable providers
export const createMockAgent = (providers: MockProvider[] = []) => {
  const providerMap = new Map();
  providers.forEach(provider => {
    providerMap.set(`${provider.name}:${provider.model}`, provider);
  });

  const agent = {
    executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
      if (toolName === 'bash') {
        return { stdout: 'mock shell output', stderr: '', exitCode: 0 };
      }
      return { result: 'mock tool result' };
    }),
    executeStep: vi.fn().mockImplementation(async (stepInfo: any) => {
      return { status: 'completed', result: `Mock step execution for ${stepInfo.id}` };
    }),
    setProvider: vi.fn().mockImplementation((providerName: string) => {
      return providerMap.get(providerName);
    }),
    getProvider: vi.fn().mockImplementation(() => {
      return providers[0]; // Return first provider by default
    }),
    provider: {
      getName: () => 'anthropic',
      getModel: () => 'claude-sonnet-4-20250514'
    }
  };

  agent.switchModel = vi.fn().mockImplementation((model: string) => {
    const [providerName, modelName] = model.includes(':') ? model.split(':', 2) : ['anthropic', model];
    const provider = providerMap.get(`${providerName}:${modelName}`) || providers[0];
    agent.provider = {
      getName: () => providerName,
      getModel: () => modelName
    };
    return provider;
  });

  return agent;
};