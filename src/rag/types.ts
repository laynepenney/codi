/**
 * RAG System Types
 *
 * Defines interfaces for the Retrieval-Augmented Generation system
 * including code chunks, configuration, and retrieval results.
 */

/**
 * A chunk of code with metadata for indexing.
 */
export interface CodeChunk {
  /** Unique identifier (hash of content + location) */
  id: string;
  /** The actual code/text content */
  content: string;
  /** Absolute path to source file */
  filePath: string;
  /** Path relative to project root */
  relativePath: string;
  /** Line number where chunk starts (1-indexed) */
  startLine: number;
  /** Line number where chunk ends (1-indexed) */
  endLine: number;
  /** Detected programming language */
  language: string;
  /** Type of code unit */
  type: 'function' | 'class' | 'method' | 'block' | 'file';
  /** Function/class/method name if applicable */
  name?: string;
  /** Additional context (imports, exports, etc.) */
  metadata?: Record<string, string>;
}

/**
 * Result from a RAG query.
 */
export interface RetrievalResult {
  /** The matching code chunk */
  chunk: CodeChunk;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Index statistics.
 */
export interface IndexStats {
  /** Total number of indexed files */
  totalFiles: number;
  /** Total number of code chunks */
  totalChunks: number;
  /** When the index was last updated */
  lastIndexed: Date | null;
  /** Size of the index on disk in bytes */
  indexSizeBytes: number;
  /** Embedding provider being used */
  embeddingProvider: string;
  /** Embedding model being used */
  embeddingModel: string;
  /** Whether indexing is currently in progress */
  isIndexing: boolean;
  /** Number of files queued for indexing */
  queuedFiles: number;
}

/**
 * Configuration for the RAG system.
 */
export interface RAGConfig {
  /** Whether RAG is enabled */
  enabled: boolean;
  /** Embedding provider to use */
  embeddingProvider: 'openai' | 'ollama' | 'auto';
  /** OpenAI embedding model (default: text-embedding-3-small) */
  openaiModel: string;
  /** Ollama embedding model (default: nomic-embed-text) */
  ollamaModel: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl: string;
  /** Chunking strategy */
  chunkStrategy: 'code' | 'fixed';
  /** Maximum tokens per chunk (approximate) */
  maxChunkSize: number;
  /** Overlap between chunks in tokens */
  chunkOverlap: number;
  /** Number of results to return */
  topK: number;
  /** Minimum similarity score (0-1) */
  minScore: number;
  /** File patterns to include */
  includePatterns: string[];
  /** File patterns to exclude */
  excludePatterns: string[];
  /** Whether to auto-index on startup */
  autoIndex: boolean;
  /** Whether to watch for file changes */
  watchFiles: boolean;
}

/**
 * Default RAG configuration.
 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  enabled: false,
  embeddingProvider: 'auto',
  openaiModel: 'text-embedding-3-small',
  ollamaModel: 'nomic-embed-text',
  ollamaBaseUrl: 'http://localhost:11434',
  chunkStrategy: 'code',
  maxChunkSize: 1500,
  chunkOverlap: 200,
  topK: 5,
  minScore: 0.7,
  includePatterns: [
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
    '**/*.py', '**/*.go', '**/*.rs', '**/*.java',
    '**/*.rb', '**/*.php', '**/*.c', '**/*.cpp', '**/*.h',
    '**/*.cs', '**/*.swift', '**/*.kt',
  ],
  excludePatterns: [
    '**/node_modules/**', 'node_modules/**',
    '**/dist/**', 'dist/**',
    '**/build/**', 'build/**',
    '**/out/**', 'out/**',
    '**/.git/**', '.git/**',
    '**/.svn/**', '.svn/**',
    '*.min.js', '*.bundle.js', '*.map',
    '**/__pycache__/**', '__pycache__/**',
    '**/.venv/**', '.venv/**',
    '**/venv/**', 'venv/**',
    '**/target/**', 'target/**',
    '**/vendor/**', 'vendor/**',
    '**/coverage/**', 'coverage/**',
    '**/.nyc_output/**', '.nyc_output/**',
    '**/.next/**', '.next/**',
  ],
  autoIndex: true,
  watchFiles: true,
};

/**
 * Progress callback for indexing operations.
 */
export type IndexProgressCallback = (current: number, total: number, file: string) => void;

/**
 * Completion callback for indexing operations.
 */
export type IndexCompleteCallback = (stats: IndexStats) => void;

/**
 * Error callback for indexing operations.
 */
export type IndexErrorCallback = (error: Error) => void;
