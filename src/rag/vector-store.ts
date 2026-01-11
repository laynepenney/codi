/**
 * Vector Store
 *
 * Wrapper around vectra LocalIndex for storing and querying code embeddings.
 */

import { LocalIndex } from 'vectra';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { CodeChunk, RetrievalResult } from './types.js';

/** Directory where all indexes are stored */
const INDEX_BASE_DIR = path.join(os.homedir(), '.codi', 'index');

/**
 * Metadata stored with each vector in the index.
 */
interface ChunkMetadata {
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  language: string;
  chunkType: string;
  name: string;
  content: string;
  [key: string]: string | number | boolean;
}

/**
 * Vector store for code embeddings using vectra.
 */
export class VectorStore {
  private index: LocalIndex<ChunkMetadata> | null = null;
  private projectPath: string;
  private indexPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.indexPath = this.getIndexPath();
  }

  /**
   * Generate a unique index path based on project path.
   */
  private getIndexPath(): string {
    const hash = crypto
      .createHash('md5')
      .update(this.projectPath)
      .digest('hex')
      .slice(0, 8);
    const projectName = path.basename(this.projectPath);
    return path.join(INDEX_BASE_DIR, `${projectName}-${hash}`);
  }

  /**
   * Initialize or load the vector index.
   */
  async initialize(): Promise<void> {
    // Ensure base directory exists
    if (!fs.existsSync(INDEX_BASE_DIR)) {
      fs.mkdirSync(INDEX_BASE_DIR, { recursive: true });
    }

    this.index = new LocalIndex<ChunkMetadata>(this.indexPath);

    if (!(await this.index.isIndexCreated())) {
      await this.index.createIndex({
        version: 1,
        metadata_config: {
          indexed: ['filePath', 'language', 'chunkType'],
        },
      });
    }
  }

  /**
   * Add or update a chunk in the index.
   */
  async upsert(chunk: CodeChunk, embedding: number[]): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    await this.index.upsertItem({
      id: chunk.id,
      vector: embedding,
      metadata: {
        filePath: chunk.filePath,
        relativePath: chunk.relativePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        language: chunk.language,
        chunkType: chunk.type,
        name: chunk.name || '',
        content: chunk.content,
      },
    });
  }

  /**
   * Insert multiple chunks in a batch.
   */
  async batchUpsert(
    chunks: CodeChunk[],
    embeddings: number[][]
  ): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings arrays must have same length');
    }

    await this.index.beginUpdate();

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await this.index.upsertItem({
          id: chunk.id,
          vector: embeddings[i],
          metadata: {
            filePath: chunk.filePath,
            relativePath: chunk.relativePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
            chunkType: chunk.type,
            name: chunk.name || '',
            content: chunk.content,
          },
        });
      }

      await this.index.endUpdate();
    } catch (error) {
      this.index.cancelUpdate();
      throw error;
    }
  }

  /**
   * Delete all chunks for a specific file.
   */
  async deleteByFile(filePath: string): Promise<number> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Find all items with this file path
    const items = await this.index.listItemsByMetadata({
      filePath: { $eq: filePath },
    });

    if (items.length === 0) {
      return 0;
    }

    await this.index.beginUpdate();

    try {
      for (const item of items) {
        await this.index.deleteItem(item.id);
      }
      await this.index.endUpdate();
      return items.length;
    } catch (error) {
      this.index.cancelUpdate();
      throw error;
    }
  }

  /**
   * Query for similar chunks.
   */
  async query(
    embedding: number[],
    topK: number = 5,
    minScore: number = 0.7
  ): Promise<RetrievalResult[]> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // vectra's queryItems signature: (vector, query, topK, filter?, isBm25?)
    // The query string is for BM25 search - we pass empty string for pure vector search
    const results = await this.index.queryItems(embedding, '', topK);

    return results
      .filter((r) => r.score >= minScore)
      .map((r) => ({
        chunk: {
          id: r.item.id,
          content: r.item.metadata.content,
          filePath: r.item.metadata.filePath,
          relativePath: r.item.metadata.relativePath,
          startLine: r.item.metadata.startLine,
          endLine: r.item.metadata.endLine,
          language: r.item.metadata.language,
          type: r.item.metadata.chunkType as CodeChunk['type'],
          name: r.item.metadata.name || undefined,
        },
        score: r.score,
      }));
  }

  /**
   * Get all indexed file paths.
   */
  async getIndexedFiles(): Promise<string[]> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    const items = await this.index.listItems();
    const files = new Set<string>();

    for (const item of items) {
      files.add(item.metadata.filePath);
    }

    return Array.from(files);
  }

  /**
   * Get index statistics.
   */
  async getStats(): Promise<{ itemCount: number; sizeBytes: number }> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    const stats = await this.index.getIndexStats();
    let sizeBytes = 0;

    // Calculate directory size
    if (fs.existsSync(this.indexPath)) {
      const files = fs.readdirSync(this.indexPath);
      for (const file of files) {
        const filePath = path.join(this.indexPath, file);
        const fileStat = fs.statSync(filePath);
        if (fileStat.isFile()) {
          sizeBytes += fileStat.size;
        }
      }
    }

    return {
      itemCount: stats.items,
      sizeBytes,
    };
  }

  /**
   * Clear the entire index.
   */
  async clear(): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    await this.index.deleteIndex();
    await this.index.createIndex({
      version: 1,
      metadata_config: {
        indexed: ['filePath', 'language', 'chunkType'],
      },
    });
  }

  /**
   * Get the index path.
   */
  getPath(): string {
    return this.indexPath;
  }
}
