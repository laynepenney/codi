# Interactive Workflow Testing Guide

This guide shows how to test the new Phase 4 (Loop) and Phase 5 (Interactive) workflow features.

## Quick Start

```bash
cd /Users/layne/Development/genai/dev3
pnpm dev
```

Once Codi starts, try these commands:

---

## Test 1: List Available Workflows

```
/workflow list
```

Should show:
- test-conditional
- test-interactive
- test-interactive-comprehensive
- test-interactive-enhanced
- test-loop
- test-model-switch
- test-switch-demo

---

## Test 2: Show Workflow Details

### Simple Interactive Workflow
```
/workflow show test-interactive
```

Should display:
- Description
- Step count
- Individual step details

### Enhanced Interactive Workflow
```
/workflow show test-interactive-enhanced
```

Should show advanced features like:
- Multiple input types (confirm, choice, text)
- Timeout configurations
- Validation patterns
- Default values

### Loop Workflow
```
/workflow show test-loop
```

Should show:
- Loop step with iteration logic
- Condition for loop execution
- maxIterations safety limit

---

## Test 3: Validate Workflow Syntax

```
/workflow validate test-interactive
```

Should report: ✅ Workflow is valid

```
/workflow validate test-interactive-enhanced
```

Should report: ✅ Workflow is valid (with enhanced features)

```
/workflow validate test-loop
```

Should report: ✅ Workflow is valid

---

## Test 4: Run Simple Workflow

```
/workflow-run test-interactive
```

Expected behavior:
1. Step 1 (shell): Welcome message
2. Step 2 (interactive): Prompt for confirmation
3. Step 3 (shell): Completion message

---

## Test 5: Run Enhanced Workflow

```
/workflow-run test-interactive-enhanced
```

Expected behavior:
1. Welcome message
2. Interactive confirmation with timeout
3. User preferences with choice input
4. Multiple interactive interactions
5. Completion message

---

## Test 6: Run Loop Workflow

```
/workflow-run test-loop
```

Expected behavior:
1. Initialize loop variables
2. Execute loop body with iteration tracking
3. Check condition for repeat
4. Respect maxIterations limit
5. Complete when condition fails

---

## Test 7: Comprehensive Test

```
/workflow-run test-interactive-comprehensive
```

This workflow has:
- 7 total steps
- 3 interactive steps
- Shell commands between interactions
 Demonstrates a real-world workflow pattern

---

## Expected Features

### Phase 4 - Loop Support ✓
- Execute steps in iteration
- Loop condition checking
- maxIterations safety limit
- Iteration counting in state

### Phase 5 - Interactive Features ✓
- Multiple input types:
  - `text` - plain text input
  - `password` - masked input
  - `confirm` - yes/no confirmation
  - `choice` - select from options
  - `multiline` - multi-line text
- Timeout handling (`timeoutMs`)
- Default values (`defaultValue`)
- Validation patterns (`validationPattern`)
- Choice options (`choices` array)

---

## Troubleshooting

If workflows don't work:

1. Check workflow files exist:
   ```bash
   ls -la workflows/
   ```

2. Verify build:
   ```bash
   pnpm build
   ```

3. Run tests:
   ```bash
   pnpm test workflow
   ```

4. Check integration:
   ```bash
   grep "interactive" src/workflow/steps/index.ts
   grep "loop" src/workflow/steps/index.ts
   ```

---

## Verification Summary

From automated checks:

| Workflow | Steps | Interactive | Loop | Status |
|----------|-------|-------------|------|--------|
| test-interactive | 3 | 1 | 0 | ✅ |
| test-interactive-enhanced | 8 | 5 | 0 | ✅ |
| test-interactive-comprehensive | 7 | 3 | 0 | ✅ |
| test-loop | 4 | 0 | 1 | ✅ |

All workflows validated and ready for testing! 🚀