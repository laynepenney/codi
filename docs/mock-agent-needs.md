# Mock Agent Improvements Needed for PR Review E2E Tests

## Summary

The mock agent infrastructure in `tests/workflow-mocks.ts` needs enhancements to properly support PR review workflow E2E tests. Currently, 9 tests in `tests/workflow-pr-review-e2e.test.ts` fail because the mock agent doesn't fully simulate workflow execution.

## Current State

### What Works ✅

The mock agent successfully supports:
- **Multi-model peer review tests**: 10/10 passing
- **Minimal validation tests**: 3/3 passing
- **Core workflow execution**: Model switching, basic steps

### What Doesn't Work ❌

PR review E2E tests (9 tests) fail because:
1. `agent.chat` function not implemented
2. Model state tracking incomplete
3. Workflow step execution not fully simulated
4. Agent callbacks not properly mocked

## Issues Identified

### Issue 1: Missing `agent.chat` Function

**Error**: `AI prompt execution failed: agent.chat is not a function`

**Current Mock Agent**:
```typescript
return {
  executeTool: vi.fn().mockImplementation(...),
  executeStep: vi.fn().mockImplementation(...),
  setProvider: vi.fn().mockImplementation(...),
  getProvider: vi.fn().mockImplementation(...),
  // ❌ Missing: chat() function
};
```

**Why It's Needed**: 
AI prompt steps attempt to call `agent.chat()` to generate responses from AI models.

**Required Implementation**:
```typescript
chat: vi.fn().mockImplementation(async (prompt, options?) => {
  const provider = this.provider || mockProviders[0];
  return provider.streamChat(
    [{ role: 'user', content: prompt }],
    { model: provider.getModel() },
    { onText: options?.onText }
  );
});
```

### Issue 2: Incomplete Model State Tracking

**Current Problem**: `setProvider()` doesn't update `this.provider` properly

**Current Implementation**:
```typescript
setProvider: vi.fn().mockImplementation((providerName) => {
  return providerMap.get(providerName); // ❌ Doesn't update state
}),
```

**Required**:
```typescript
setProvider: vi.fn().mockImplementation((providerOrName) => {
  if (typeof providerOrName === 'string') {
    const provider = providerMap.get(providerOrName);
    this.provider = provider;
    return provider;
  }
  // If a provider object is passed
  this.provider = providerOrName;
  return providerOrName;
}),
```

### Issue 3: Workflow Step Execution Not Simulated

**Current Problem**: `executeStep()` doesn't actually simulate step execution

**Current Implementation**:
```typescript
executeStep: vi.fn().mockImplementation(async (stepInfo) => {
  return { status: 'completed', result: `Mock step execution for ${stepInfo.id}` };
}),
```

**Required Step**:
```typescript
executeStep: vi.fn().mockImplementation(async (stepInfo) => {
  const step = stepInfo;
  
  try {
    switch (step.action) {
      case 'shell':
        return this.executeTool('bash', { command: step.command });
      
      case 'ai-prompt':
        const provider = this.getProvider();
        const response = await agent.chat(step.prompt, {
          model: step.model || provider.getModel()
        });
        return { 
          status: 'completed', 
          result: response.response || response 
        };
      
      case 'switch-model':
        const newProvider = this.switchModel(step.model);
        return { 
          status: 'completed',
          result: `Switched to ${newProvider.getModel()}`
        };
      
      default:
        return { 
          status: 'completed', 
          result: `Executed ${step.action}` 
        };
    }
  } catch (error) {
    return {
      status: 'failed',
      result: error.message
    };
  }
}),
```

### Issue 4: Missing Callbacks Support

**Current Problem**: Agent callbacks not available for streaming responses

**Required**:
```typescript
return {
  // ... existing methods
  callbacks: {
    onText: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onConfirm: vi.fn()
  }
};
```

### Issue 5: Proper `this` Binding

**Current Problem**: Method implementations use `mockAgent` reference incorrectly

**Required**: Use closures or arrow functions to maintain `this` context properly.

## Proposed Enhanced Mock Agent

```typescript
export const createMockAgent = (providers: MockProvider[] = []) => {
  const providerMap = new Map<MockProvider, string>();
  providers.forEach(provider => {
    providerMap.set(`${provider.name}:${provider.model}`, provider);
  });

  // Agent state
  let currentProvider = providers[0];

  const agent = {
    // State
    provider: currentProvider,
    
    // Tool execution
    executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
      if (toolName === 'bash') {
        return { stdout: 'mock shell output', stderr: '', exitCode: 0 };
      }
      return { result: 'mock tool result' };
    }),
    
    // AI chat - THE KEY MISSING PIECE
    chat: vi.fn().mockImplementation(async (messagesOrPrompt, options = {}, callbacks = {}) => {
      const provider = agent.provider as MockProvider;
      const model = options.model || provider.getModel();
      
      // Convert string prompt to message format
      const messages = typeof messagesOrPrompt === 'string'
        ? [{ role: 'user' as const, content: messagesOrPrompt }]
        : messagesOrPrompt;
      
      // Generate response from provider
      const response = await provider.generateResponse(
        messages.map(m => m.content).join(' '),
        model
      );
      
      // Simulate streaming if callback provided
      if (callbacks.onText) {
        const chunks = response.split(' ');
        for (const chunk of chunks) {
          callbacks.onText(chunk + ' ');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      return response;
    }),
    
    // Step execution with simulation
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
              { model: step.model },
              { onText: vi.fn() }
            );
            return { 
              status: 'completed', 
              result: response
            };
          
          case 'switch-model':
            const newProvider = agent.switchModel(step.model);
            return { 
              status: 'completed',
              result: `Switched to ${newProvider.getModel()}`
            };
          
          default:
            return { 
              status: 'completed',
              result: `Executed ${step.action}: ${step.id}`
            };
        }
      } catch (error) {
        return {
          status: 'failed',
          result: error instanceof Error ? error.message : String(error)
        };
      }
    }),
    
    // Provider management
    setProvider: vi.fn().mockImplementation((providerOrName) => {
      if (typeof providerOrName === 'string') {
        const provider = providerMap.get(providerOrName);
        if (provider) {
          agent.provider = provider;
        }
        return provider;
      }
      // Provider object
      agent.provider = providerOrName;
      return providerOrName;
    }),
    
    switchModel: vi.fn().mockImplementation((model: string) => {
      const [providerName, modelName] = model.includes(':') 
        ? model.split(':', 2) 
        : [currentProvider.name, model];
      
      const provider = providerMap.get(`${providerName}:${modelName}`) 
        || providers[0];
      
      agent.provider = provider;
      currentProvider = provider;
      return provider;
    }),
    
    getProvider: vi.fn().mockImplementation(() => {
      return agent.provider;
    }),
    
    // Callbacks
    callbacks: {
      onText: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue({ approved: true })
    }
  };
  
  return agent;
};
```

## Test Requirements

### Tests That Need These Improvements

From `tests/workflow-pr-review-e2e.test.ts`:

1. **should execute complete PR review workflow successfully**
   - Needs: `agent.chat()` for AI prompt steps
   
2. **should handle PR-specific scenarios**
   - Needs: Proper model switching and chat responses
   
3. **should handle GitHub PR review format generation**
   - Needs: Multi-step execution with final output
   
4. **should switch between models for different PR review stages**
   - Needs: `setProvider()` state tracking
   
5. **should use appropriate models for each PR review phase**
   - Needs: Model state persistence
   
6. **should handle model switching failures gracefully**
   - Needs: Error handling in `switchModel()`
   
7. **should handle PR-specific errors**
   - Needs: Graceful failure in `executeStep()`
   
8. **should generate actionable PR feedback**
   - Needs: End-to-end workflow execution
   
9. **should provide code review best practices**
   - Needs: Complete workflow simulation

## Implementation Priority

### High Priority (Required for tests to pass)
1. ✅ Add `chat()` method
2. ✅ Fix `setProvider()` state tracking
3. ✅ Enhance `executeStep()` to simulate all action types

### Medium Priority (Better simulation)
4. Add proper error handling
5. Implement callbacks support
6. Add step execution timing

### Low Priority (Nice to have)
7. Add workflow state persistence
8. Implement progress tracking
9. Add streaming with realistic delays

## How to Test Improvements

After implementing improvements, run:

```bash
# Test PR review E2E tests
pnpm run test tests/workflow-pr-review-e2e.test.ts

# Verify all tests pass
pnpm run test tests/workflow-*.test.ts
```

Expected result: 
- PR review E2E tests: 9/9 passing
- All workflow tests: 22/22 passing

## Related Files

- `tests/workflow-mocks.ts` - Mock agent implementation
- `tests/workflow-pr-review-e2e.test.ts` - Tests that need improvements
- `tests/workflow-multi-model-e2e.test.ts` - Working reference implementation
- `src/workflow/executor.ts` - Real executor for reference
- `src/workflow/steps/ai-prompt.ts` - AI prompt step implementation

## Notes

- The mock agent should simulate the **real Agent** behavior from `src/agent.ts`
- Focus on the **essential methods** needed for workflow execution
- Don't implement full streaming - basic simulation is sufficient
- Error handling should match real workflow behavior
- Keep tests **fast** - avoid unnecessary delays

---

**Status**: Documentation complete, awaiting implementation  
**Priority**: Medium 
**Estimated effort**: 2-4 hours  
**Impact**: Enables 9 additional passing tests

Wingman: Codi <codi@layne.pro>