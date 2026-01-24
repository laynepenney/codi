# Model Map Embedding Integration Plan

## Overview

Integrate the existing Model Map system with the RAG (Retrieval-Augmented Generation) embedding provider selection, allowing users to configure embedding models through a single, unified configuration system.

## Current State

### RAG Embedding Configuration
Embedding models are currently configured separately from chat models:
```json
{
  "rag": {
    "embeddingProvider": "ollama",
    "ollamaModel": "nomic-embed-text",
    "openaiModel": "text-embedding-3-small",
    "ollamaBaseUrl": "http://localhost:11434"
  }
}
```

### Model Map System
The model map (`~/.codi/models.yaml`) currently manages chat models with named definitions and task routing:
```yaml
models:
  haiku:
    provider: anthropic
    model: claude-3-5-haiku-latest
    description: "Fast, cheap model for quick tasks"

tasks:
  fast:
    model: haiku
    description: "Quick text operations"
  code:
    model: sonnet
    description: "Code generation and analysis"
```

## Proposed Changes

### 1. Add Embedding Task Type

Add a dedicated task category for embeddings in the model map:

```yaml
# ~/.codi/models.yaml
version: "1"

models:
  # Fast/local embedding models
  nomic-embed-small:
    provider: ollama
    model: nomic-embed-text
    description: "Fast embedding model (384d, ~0.4MB) - suitable for rapid indexing"
    baseUrl: "http://localhost:11434"
  
  # High-quality embedding models
  nomic-embed-large:
    provider: ollama
    model: mxbai-embed-large
    description: "High-quality embeddings (1024d) - better accuracy"
    baseUrl: "http://localhost:11434"
  
  # Cloud embedding models
  openai-embed-small:
    provider: openai
    model: text-embedding-3-small
    description: "Fast OpenAI embeddings (1536d) - good balance of speed/quality"
    maxTokens: 8191
  
  openai-embed-large:
    provider: openai
    model: text-embedding-3-large
    description: "High-quality OpenAI embeddings (3072d) - best for accuracy"
    maxTokens: 8191

# Task categories including embeddings
tasks:
  fast:
    model: haiku
    description: "Quick operations"
  
  code:
    model: sonnet
    description: "Code operations"
  
  embeddings:
    model: nomic-embed-small
    description: "Model for generating semantic embeddings"
    priority: "production"  # Production use

# Per-command overrides
commands:
  /index:
    task: embeddings
    description: "Primary RAG indexing task"
```

### 2. Extend RAGConfig Interface

Add model map integration options:

```typescript
export interface RAGConfig {
  enabled: boolean;
  
  // Existing configuration
  embeddingProvider: 'openai' | 'ollama' | 'modelmap' | 'auto';
  openaiModel: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
  
  // NEW: Model map configuration
  embeddingTask?: string;  // Task name from model map (default: "embeddings")
  embeddingModelMapPath?: string;  // Path to model map YAML (default: ~/.codi/models.yaml)
  
  // ... rest of config
}
```

### 3. Update createEmbeddingProvider()

Enhance the factory to use model map when requested:

```typescript
export function createEmbeddingProvider(
  config: RAGConfig,
  modelMap?: ModelMapConfig  // Optional model map instance
): BaseEmbeddingProvider {
  const provider = config.embeddingProvider;

  // NEW: Model map provider
  if (provider === 'modelmap' && modelMap) {
    const taskName = config.embeddingTask || 'embeddings';
    const task = modelMap.tasks?.[taskName];
    
    if (!task || !task.model) {
      throw new Error(`Embedding task '${taskName}' not found in model map`);
    }
    
    const modelDef = modelMap.models[task.model];
    if (!modelDef) {
      throw new Error(`Model '${task.model}' not found in model map`);
    }
    
    return createEmbeddingProviderFromModelDef(modelDef);
  }

  // Existing providers...
  if (provider === 'openai') {
    return new OpenAIEmbeddingProvider(config.openaiModel);
  }

  if (provider === 'ollama') {
    return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl);
  }

  // Auto-detect...
  return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl);
}
```

### 4. Helper Function: createEmbeddingProviderFromModelDef()

```typescript
function createEmbeddingProviderFromModelDef(
  modelDef: ModelDefinition
): BaseEmbeddingProvider {
  switch (modelDef.provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider(modelDef.model);
    
    case 'ollama':
    case 'ollama-cloud':
      return new OllamaEmbeddingProvider(
        modelDef.model,
        modelDef.baseUrl || 'http://localhost:11434'
      );
    
    default:
      throw new Error(`Unsupported embedding provider: ${modelDef.provider}`);
  }
}
```

### 5. Integration Points

Update RAG initialization in `index.ts`:

```typescript
// Load model map if it exists
let modelMapConfig: ModelMapConfig | null = null;
try {
  modelMapConfig = loadModelMap();
} catch (error) {
  logger.debug(`Could not load model map: ${error}`);
}

// Create embedding provider with model map support
ragEmbeddingProvider = createEmbeddingProvider(ragConfig, modelMapConfig);
```

## Configuration Examples

### Example 1: Use Model Map for Embeddings (Production)

```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "modelmap",
    "embeddingTask": "embeddings",
    "autoIndex": true
  }
}
```

**models.yaml**:
```yaml
tasks:
  embeddings:
    model: nomic-embed-small  # Use fast local model
    description: "Production embeddings"
```

### Example 2: Local Development with High Quality

```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "modelmap",
    "embeddingTask": "embeddings-dev"
  }
}
```

**models.yaml**:
```yaml
tasks:
  embeddings:
    model: nomic-embed-small  # For production
    description: "Default embeddings"
  
  embeddings-dev:
    model: openai-embed-large  # Better quality for dev
    description: "High-quality dev embeddings"
```

### Example 3: Per-Project Configuration

**Project A** (`.codi.json`):
```json
{
  "rag": {
    "embeddingProvider": "modelmap",
    "embeddingTask": "embeddings"
  }
}
```

**Project B** (`.codi.json`):
```json
{
  "rag": {
    "embeddingProvider": "ollama",  // Direct configuration
    "ollamaModel": "llama2"
  }
}
```

### Example 4: Fallback Configuration

```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "modelmap",
    "embeddingTask": "embeddings",
    "ollamaModel": "nomic-embed-text",  // Fallback if model map fails
    "ollamaBaseUrl": "http://localhost:11434"
  }
}
```

## Benefits

### 1. Unified Configuration
- Single source of truth for all models (chat + embeddings)
- Consistent terminology and structure
- Easier to understand and maintain

### 2. Easy Model Switching
- Switch embedding models by changing task name
- Try different models without editing multiple config files
- Per-environment configurations (dev vs production)

### 3. Cost Optimization
- Use fast local models for development
- Use high-quality cloud models for production
- Easy to compare embedding models

### 4. Consistency with Chat Models
- Same system for selecting chat and embedding models
- Shared fallback chains
- Unified model management

## Implementation Steps

### Phase 1: Core Integration
1. Update `RAGConfig` type with `embeddingTask` field
2. Add `createEmbeddingProviderFromModelDef()` helper
3. Update `createEmbeddingProvider()` to support `'modelmap'` provider
4. Add fallback logic (modelmap → manual config → auto-detect)

### Phase 2: Documentation
1. Add example models.yaml with embedding models
2. Update README with embedding configuration examples
3. Add `/index` command help text
4. Document task naming conventions

### Phase 3: Testing
1. Unit tests for model map provider creation
2. Integration tests with actual models.yaml
3. Fallback behavior tests
4. Cross-platform tests (local vs cloud)

### Phase 4: Features (Optional Future Enhancements)
1. Add `/rag switch-model <task>` command
2. Support for multiple embedding models (hybrid embedding)
3. Embedding model benchmarking/selection
4. Per-file-type embedding model selection

## Testing Plan

### Unit Tests

```typescript
// tests/embedding-modelmap.test.ts

describe('Model Map Embedding Provider', () => {
  it('should create provider from model map task', async () => {
    const modelMap = createTestModelMap({
      tasks: {
        embeddings: { model: 'nomic-embed-small' }
      }
    });
    
    const config: RAGConfig = {
      embeddingProvider: 'modelmap',
      embeddingTask: 'embeddings'
    };
    
    const provider = createEmbeddingProvider(config, modelMap);
    expect(provider.getName()).toBe('ollama');
    expect(provider.getModel()).toBe('nomic-embed-text');
  });

  it('should fallback to manual config if model map fails', async () => {
    const config: RAGConfig = {
      embeddingProvider: 'modelmap',
      embeddingTask: 'missing-task',
      ollamaModel: 'fallback-model'
    };
    
    const provider = createEmbeddingProvider(config, null);
    // Should use auto-detect fallback
    expect(provider).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// tests/rag-modelmap.integration.test.ts

describe('RAG with Model Map', () => {
  it('should index with model map embeddings', async () => {
    // Create test models.yaml
    const modelMapPath = createTestModelMapYaml({
      models: { 'embed-test': { provider: 'ollama', model: 'nomic' } },
      tasks: { embeddings: { model: 'embed-test' } }
    });
    
    const config: RAGConfig = {
      embeddingProvider: 'modelmap',
      embeddingTask: 'embeddings',
      embeddingModelMapPath: modelMapPath
    };
    
    const indexer = new BackgroundIndexer(cwd, createEmbeddingProvider(config), config);
    const stats = await indexer.indexFiles(['test.ts']);
    
    expect(stats.embeddingProvider).toBe('ollama');
  });
});
```

### E2E Tests

Test with actual Ollama/OpenAI providers:
- Model map configuration loads correctly
- Embeddings are generated with specified model
- Fallback behavior works when model is unavailable
- Switching tasks changes embedding model

## Considerations & Risks

### Risk 1: Breaking Changes
- **Mitigation**: Maintain backward compatibility with existing config
- All existing configurations should continue to work unchanged

### Risk 2: Model Unavailability
- **Risk**: Specified model might not be available
- **Mitigation**: Add fallback to manual config, then auto-detect
- Log warnings when fallbacks are used

### Risk 3: Performance Impact
- **Risk**: Loading model map adds startup overhead
- **Mitigation**: Lazy loading, caching of model map
- Fail gracefully if model map is missing

### Risk 4: Complexity
- **Risk**: Two ways to configure embeddings (manual + model map)
- **Mitigation**: Clear documentation, prefer model map as primary method
- Deprecation warnings for legacy config

## Success Criteria

- ✅ Model map can successfully configure embedding providers
- ✅ All existing RAG configurations continue to work
- ✅ Fallback chain works: modelmap → manual config → auto-detect
- ✅ Documentation covers all configuration options
- ✅ Tests cover new functionality and fallback paths
- ✅ Switching models via model map works correctly
- ✅ `/rag --status` shows correct provider and model

## Timeline Estimate

- **Phase 1**: 2-3 hours (core changes)
- **Phase 2**: 1 hour (documentation)
- **Phase 3**: 2-3 hours (tests)
- **Phase 4**: Future work (not estimated)

**Total**: ~5-7 hours for complete implementation

## Related Work

- Model Map System (`src/model-map/`) - Existing infrastructure
- RAG Embedding Providers (`src/rag/embeddings/`) - Target for integration
- Configuration System (`src/config.ts`) - Config loading
- Indexer (`src/rag/indexer.ts`) - Uses embedding provider

## Open Questions

1. Should we add a `/rag embed-list` command to show available embedding models?
2. Should embedding models support priority/task categories like chat models?
3. Should we support per-file-type embedding model selection?
4. Should we add embedding model benchmarking/comparison tools?