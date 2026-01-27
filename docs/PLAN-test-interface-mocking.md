# Plan: Ensure Correct Interface Mocking in Tests

**Created:** 2026-01-05  
**Status:** Draft  
**Priority:** High

## Problem Statement

Recently discovered a bug where tests were mocking the **implementation** of interfaces instead of the **actual interface signatures**. This caused tests to pass even when the code was broken.

### Example of the Bug

**❌ Incorrect Test (mocked wrong interface):**
```typescript
const mockAgent = {
  chat: vi.fn().mockResolvedValue({ text: 'response' }) // Wrong!
};
```

**✅ Correct Test (mocked actual interface):**
```typescript
const mockAgent = {
  chat: vi.fn().mockResolvedValue('response') // Correct!
};
```

**Real Agent Interface:** `chat(userMessage: string): Promise<string>` returns a **string**, not an object.

### Why This Happens
- Tests were written to match what the code **expected** (wrong implementation)
- Tests should match what the function **actually returns** (correct interface)
- This creates false confidence - tests pass but code fails in production

---

## Goals

1. **Audit all test files** for incorrect interface mocking
2. **Fix all incorrect mocks** to match actual interfaces
3. **Add guidelines** for future test writing
4. **Consider adding TypeScript checks** to prevent this

---

## Audit Checklist

### What to Look For

Review each test file and check:

- [ ] **Mock return types** - Do they match the actual function signatures?
- [ ] **Agent mocking** - Does `agent.chat()` return the right type?
- [ ] **Provider mocking** - Do provider methods return what they actually return?
- [ ] **Tool returns** - Do tools return strings or objects as specified?
- [ ] **Context objects** - Are mock context objects complete and correct?
- [ ] **Event listeners** - Are callbacks called with correct arguments?

### Common Patterns to Check

| Component | Actual Return | Common Mock Mistake |
|-----------|--------------|--------------------|
| `agent.chat()` | `Promise<string>` | `{ text: string }` or `{ response: string }` |
| `provider.streamChat()` | `Promise<void>` (uses callbacks) | Returns object |
| Tool `execute()` | `Promise<string>` | Returns object |
| `read_file` tool | Returns file content string | Returns parsed object |

### Files to Review

**Core Test Files:**
- [ ] `tests/workflow-ai-builder.test.ts` ✅ (already fixed)
- [ ] `tests/workflow-actions.test.ts`
- [ ] `tests/workflow-commands.e2e.test.ts`
- [ ] `tests/workflow-edge-cases.test.ts`
- [ ] `tests/workflow-integration.test.ts`
- [ ] `tests/workflow-mocks.ts`
- [ ] `tests/workflow-multi-model-e2e.test.ts`
- [ ] `tests/workflow-pr-review-e2e.test.ts`
- [ ] `tests/workflow-pr-review-minimal.test.ts`
- [ ] `tests/workflow-steps.test.ts`
- [ ] `tests/workflow.test.ts`

**Other Test Files:**
- [ ] `tests/agent-mocking.test.ts` (if exists)
- [ ] `tests/provider-mocking.test.ts` (if exists)
- [ ] `tests/tool-mocking.test.ts` (if exists)

---

## Step-by-Step Workflow

### Phase 1: Preparation
1. ✅ Understand the problem (done - this doc)
2. [ ] Review actual interface definitions:
   - `src/types.ts` - Agent, Provider, Tool interfaces
   - `src/agent.ts` - `Agent.chat()` signature
   - `src/providers/*.ts` - Provider interfaces
   - `src/tools/*.ts` - Tool `execute()` signatures

### Phase 2: Audit Each Test File
For each test file:

1. **Read the actual source file** to find the real interface
2. **Search for `vi.fn()`** and `mockResolvedValue` / `mockReturnValue`
3. **Compare mock returns** with actual interface
4. **Document issues** in an audit spreadsheet/table
5. **Fix incorrect mocks** immediately when found
6. **Run tests** to verify fixes don't break anything

### Phase 3: Add Prevention Measures
1. [ ] Add TypeScript `@ts-expect-error` comments when intentionally mocking wrong types
2. [ ] Consider adding a test helper that validates mock return types
3. [ ] Update test guidelines in `CLAUDE.md` or `CONTRIBUTING.md`
4. [ ] Add example test patterns for common scenarios

---

## Audit Template

Use this table to track issues:

| Test File | Line | Mock Target | Actual Return | Mocked Return | Status |
|-----------|------|-------------|---------------|---------------|--------|
| `workflow-ai-builder.test.ts` | 49 | `agent.chat()` | `Promise<string>` | `{ text: string }` | ✅ Fixed |
| | | | | | |
| | | | | | |

---

## Example Fixes

### Fix 1: Agent.chat() Mock

**Before:**
```typescript
const mockAgent = {
  chat: vi.fn().mockResolvedValue({ text: 'response' })
};
```

**After:**
```typescript
const mockAgent = {
  chat: vi.fn().mockResolvedValue('response')
};
```

### Fix 2: Tool.execute() Mock

**Before:**
```typescript
const mockTool = {
  execute: vi.fn().mockResolvedValue({ output: 'result' })
};
```

**After:**
```typescript
const mockTool = {
  execute: vi.fn().mockResolvedValue('result')
};
```

### Fix 3: Provider Stream with Callbacks

**Before:**
```typescript
const mockProvider = {
  streamChat: vi.fn().mockResolvedValue({ text: 'streamed' })
};
```

**After:**
```typescript
const mockProvider = {
  streamChat: vi.fn().mockImplementation(
    async (_, options) => {
      if (options?.onText) options.onText('hello');
      if (options?.onDone) options.onDone();
    }
  )
};
```

---

## Guidelines for Future Tests

### Rule #1: Mock the Interface, Not the Implementation

Always look at the actual source code to see what a function returns, then mock exactly that.

```typescript
// ❌ Don't guess or copy from buggy implementation
chat: vi.fn().mockResolvedValue({ text: '...' })

// ✅ Look at src/agent.ts, see it returns Promise<string>
chat: vi.fn().mockResolvedValue('...')
```

### Rule #2: Use TypeScript to Catch Type Errors

If your mock causes a TypeScript error, that's a good sign you're mocking the wrong interface.

```typescript
// TypeScript will warn: Type '{ text: string }' is not assignable to type 'string'
chat: vi.fn().mockResolvedValue({ text: 'response' }) // ❌
```

### Rule #3: Prefer Real Implementations over Mocks

When possible, test the actual implementation:

```typescript
// ❌ Don't do this
const mockAgent = { chat: vi.fn().mockResolvedValue('test') };

// ✅ If possible, use the real agent (or a lightweight test agent)
const testAgent = new Agent(testProvider, testRegistry);
```

### Rule #4: Add Integration Tests

Unit tests with mocks can pass with wrong interfaces. Integration tests catch these bugs.

```typescript
// Add an e2e test that calls the actual command
// tests/commands/workflow-build.e2e.test.ts
```

---

## Prevention Mechanisms

### Option 1: Mock Validators

Create a test helper that validates mocks:

```typescript
// tests/helpers/mock-validator.ts
export function validateAgentMock(mock: any) {
  if (mock.chat) {
    // Try to use it like actual code would
    const result = mock.chat('test');
    const type = typeof await result;
    if (type !== 'string') {
      throw new Error('agent.chat() must return Promise<string>');
    }
  }
}
```

### Option 2: Type Guards in Tests

```typescript
import type { Agent } from '../src/agent.js';

const mockAgent = {
  chat: vi.fn().mockResolvedValue('response')
} as Pick<Agent, 'chat'>; // Enforces correct type
```

### Option 3: Document Test Patterns

Create `tests/TEST_GUIDELINES.md` with examples of correct mocking for all major interfaces.

---

## Timeline

| Phase | Duration | Target |
|-------|----------|--------|
| Phase 1: Preparation | 1 hour | Read interface definitions |
| Phase 2: Audit | 2-4 hours | Review all test files |
| Phase 3: Fixes | 2-3 hours | Fix incorrect mocks |
| Phase 4: Prevention | 1-2 hours | Add guidelines/validation |
| **Total** | **6-10 hours** | Complete audit |

---

## Success Criteria

- [ ] All test files audited
- [ ] All incorrect mocks fixed
- [ ] All tests pass after fixes
- [ ] Test guidelines documented
- [ ] No broken tests introduced

---

## Notes

- Run `pnpm test` after each fix to catch regressions
- Update this document as new patterns are discovered
- Consider making this a periodic review task
- Add to CI? Maybe run a type-only test that validates certain mock patterns

---

## References

- Bug discovered: `workflow-ai-builder.test.ts` mocking wrong `agent.chat()` return type
- Actual interface: `src/agent.ts` line 826: `async chat(userMessage: string): Promise<string>`
- Test fix: Changed `{ text: '...' }` to `'...'` to match actual return type

---

**Next Steps:**
1. Review this plan
2. Execute Phase 1 (read interface definitions)
3. Begin Phase 2 (audit test files)
4. Fix issues as they are found