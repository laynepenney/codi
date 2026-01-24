# Embedding Provider Configuration

This is the new method for configuring embedding models - using the model map for unified model management.

## Example: Production Configuration

**`~/.codi/models.yaml`**:
```yaml
version: "1"

# Embedding models
models:
  nomic-embed-small:
    provider: ollama
    model: nomic-embed-text
    description: "Fast local embedding model (384d, ~0.4MB)"
    baseUrl: "http://localhost:11434"
  
  nomic-embed-large:
    provider: ollama
    model: mxbai-embed-large
    description: "High-quality local embeddings (1024d)"
    baseUrl: "http://localhost:11434"
  
  openai-embed-small:
    provider: openai
    model: text-embedding-3-small
    description: "Fast OpenAI embeddings (1536d) - good balance"
  
  openai-embed-large:
    provider: openai
    model: text-embedding-3-large
    description: "High-quality OpenAI embeddings (3072d) - best accuracy"

# Chat models (for reference)
haiku:
  provider: anthropic
  model: claude-3-5-haiku-latest
  description: "Fast, cheap model for quick tasks"

sonnet:
  provider: anthropic
  model: claude-sonnet-4-20250514
  description: "Balanced model for most tasks"

# Task definitions
tasks:
  fast:
    model: haiku
    description: "Quick text operations"
  
  code:
    model: sonnet
    description: "Code generation and analysis"
  
  # NEW: Embedding task
  embeddings:
    model: nomic-embed-small
    description: "Primary embedding model for RAG"
```

**`.codi.json`** (project config):
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

## Example: Development Configuration

**`~/.codi/models.yaml`**:
```yaml
version: "1"

models:
  # Use high-quality OpenAI for development
  openai-embed-dev:
    provider: openai
    model: text-embedding-3-large
    description: "High-quality dev embeddings"

tasks:
  embeddings:
    model: openai-embed-dev
    description: "Dev embeddings task"
```

**`.codi.json`**:
```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "modelmap"
    // Will use default "embeddings" task
  }
}
```

## Example: Per-Project Override

**Project A** (`.codi.json`):
```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "modelmap",
    "embeddingTask": "embeddings"
  }
}
```

**Project B** (`.codi.json`):
```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "ollama",  // Direct config (legacy)
    "ollamaModel": "llama2"
  }
}
```

## Supported Models

### Ollama (local, free)
- `nomic-embed-text` - Fast, small (384d)
- `mxbai-embed-large` - Higher quality (1024d)
- `llama2` - Can be used for embeddings

### OpenAI (cloud, costs money)
- `text-embedding-3-small` - Fast (1536d), lower cost
- `text-embedding-3-large` - High quality (3072d), higher cost
- `text-embedding-ada-002` - Legacy (1536d)

## Legacy Configuration (Still Supported)

```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "ollama",
    "ollamaModel": "nomic-embed-text",
    "ollamaBaseUrl": "http://localhost:11434"
  }
}
```

Or:

```json
{
  "rag": {
    "enabled": true,
    "embeddingProvider": "openai",
    "openaiModel": "text-embedding-3-small"
  }
}
```

## Benefits of Model Map Integration

1. **Unified Configuration** - All models in one place
2. **Easy Switching** - Change embedding model by editing task
3. **Per-Environment** - Different tasks for dev/production
4. **Consistency** - Same system for chat and embeddings
5. **Cost Optimization** - Use local models for dev, cloud for production