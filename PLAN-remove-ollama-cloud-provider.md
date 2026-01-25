# Plan: Remove Ollama Cloud Provider

## Overview
Remove the `ollama-cloud` provider implementation and consolidate all Ollama functionality under the existing `ollama` provider, which already works correctly with Ollama Cloud via the OpenAI-compatible API.

## Background
- The `ollama` provider (using OpenAI-compatible API) works correctly with Ollama Cloud
- The `ollama-cloud` provider has issues with API endpoints, authentication, and tool calling
- Maintaining two implementations for the same service creates unnecessary complexity

## Analysis of Current State

### Files Reference Ollama Cloud:

1. **Provider Registration** (`src/providers/index.ts`)
   - Line 38: `providerFactories.set('ollama-cloud', (options) => new OllamaCloudProvider(options));`
   - Line 152: Provider detection logic for `process.env.OLLAMA_CLOUD === 'true'`
   - Lines 154-156: Default to Ollama Cloud if environment variable set

2. **Provider Implementation** (`src/providers/ollama-cloud.ts`)
   - Full `OllamaCloudProvider` class (927 lines)
   - Uses Ollama's native `/api` endpoint instead of OpenAI-compatible `/v1`
   - Complex manual tool call parsing logic

3. **Configuration Files** (`src/config.ts`)
   - Line 26: Provider validation list includes `'ollama-cloud'`
   - Line 403: Valid providers include `'ollama-cloud'`

4. **CLI Options** (`src/index.ts`)
   - Line 386: CLI help text mentions `'ollama-cloud'`

5. **Static Models** (`src/models.ts`)
   - Model listings may reference `ollama-cloud` provider

## Removal Plan

### Phase 1: Remove Provider Registration and Implementation
1. **Remove provider factory registration** in `src/providers/index.ts`
   - Delete line 38: `providerFactories.set('ollama-cloud', ...)`
   - Remove provider detection logic for `ollama-cloud` (lines 152-156)
   - Update default provider detection to use `ollama` instead

2. **Delete provider implementation file**
   - Remove `src/providers/ollama-cloud.ts`
   - Remove any exports/references to `OllamaCloudProvider`

### Phase 2: Update Configuration and Validation
1. **Update provider validation** in `src/config.ts`
   - Remove `'ollama-cloud'` from valid providers list
   - Update config validation schema

2. **Update CLI help and options**
   - Remove `'ollama-cloud'` from help text in `src/index.ts`

### Phase 3: Update Documentation
1. **Update README.md**
   - Remove references to `ollama-cloud` provider
   - Update provider usage examples

2. **Update CODI.md**
   - Remove Ollama Cloud provider documentation
   - Consolidate Ollama provider documentation

### Phase 4: Testing and Verification
1. **Verify Ollama provider works with Ollama Cloud**
   ```bash
   OLLAMA_HOST=https://ollama.com pnpm dev --provider ollama --model glm-4.7:cloud
   ```

2. **Test migration path for existing users**
   - Users currently using `ollama-cloud` should switch to `ollama`
   - Update config examples and migration guide

## Migration Guide for Users

### Before (Old Way)
```bash
# Using ollama-cloud provider
codi --provider ollama-cloud --model glm-4.7:cloud
# Or in config
{
  "provider": "ollama-cloud",
  "model": "glm-4.7:cloud"
}
```

### After (New Way)
```bash
# Using regular ollama provider with Ollama Cloud
OLLAMA_HOST=https://ollama.com codi --provider ollama --model glm-4.7:cloud
# Or in config
{
  "provider": "ollama",
  "model": "glm-4.7:cloud",
  "baseUrl": "https://ollama.com/v1"
}
```

## Benefits of This Change

1. **Simplified Codebase**: One provider implementation instead of two
2. **Better Reliability**: Uses proven OpenAI-compatible API
3. **Native Tool Support**: Uses OpenAI's tool calling instead of manual parsing
4. **Reduced Maintenance**: Eliminates complex tool extraction logic
5. **Consistent UX**: Single provider type for all Ollama usage

## Risks and Mitigations

### Risk: Breaking Changes for Existing Users
- **Mitigation**: Provide clear migration guide
- **Mitigation**: Add deprecation warning in current version
- **Impact**: Low - users just need to change provider type

### Risk: Loss of Provider-Specific Features
- **Assessment**: Ollama Cloud provider had no unique features vs Ollama provider
- The Ollama provider already handles all required functionality

## Implementation Checklist

- [ ] Remove provider factory registration
- [ ] Delete `src/providers/ollama-cloud.ts`
- [ ] Update provider validation lists
- [ ] Update CLI help text
- [ ] Update documentation
- [ ] Test migration paths
- [ ] Verify Ollama provider works correctly
- [ ] Remove any remaining references

## Timeline

**Phase 1** (Provider Removal): 1 hour
**Phase 2** (Configuration Updates): 30 minutes  
**Phase 3** (Documentation): 30 minutes
**Phase 4** (Testing): 30 minutes

**Total Estimated Time**: 2.5 hours

## Post-Removal Verification

After removal, verify:
- [ ] `codi --provider ollama` works with local Ollama
- [ ] `OLLAMA_HOST=https://ollama.com codi --provider ollama` works with Ollama Cloud
- [ ] Tool calling works correctly
- [ ] No broken imports or references remain

## Notes

The regular Ollama provider is superior because:
- Uses OpenAI-compatible API format (more reliable)
- Supports native tool calling with JSON schema
- Uses proven OpenAI SDK
- Already tested and working with Ollama Cloud

The `ollama-cloud` provider attempted to use Ollama's native API but:
- Required complex manual tool parsing
- Had authentication issues
- Was less reliable overall

This consolidation simplifies the codebase while maintaining full functionality.