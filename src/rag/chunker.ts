/**
 * Code Chunker
 *
 * Splits source code into semantic chunks (functions, classes, methods)
 * or fixed-size chunks as a fallback.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import type { CodeChunk } from './types.js';

/**
 * Configuration for the chunker.
 */
export interface ChunkerConfig {
  /** Maximum chunk size in characters (approximate) */
  maxChunkSize: number;
  /** Overlap between chunks in characters */
  chunkOverlap: number;
  /** Minimum chunk size to keep */
  minChunkSize: number;
}

/**
 * Default chunker configuration.
 */
export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxChunkSize: 4000, // ~1000 tokens
  chunkOverlap: 400, // ~100 tokens
  minChunkSize: 100, // Ignore very small chunks
};

/**
 * Pattern definition for detecting code structures.
 */
interface CodePattern {
  regex: RegExp;
  type: CodeChunk['type'];
}

/**
 * Language-specific patterns for code structure detection.
 */
const LANGUAGE_PATTERNS: Record<string, CodePattern[]> = {
  typescript: [
    // Export/async function declarations
    {
      regex:
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)/gm,
      type: 'function',
    },
    // Arrow function assignments
    {
      regex:
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm,
      type: 'function',
    },
    // Class declarations
    {
      regex:
        /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/gm,
      type: 'class',
    },
    // Interface declarations (treat as class for chunking)
    {
      regex: /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{/gm,
      type: 'class',
    },
    // Method definitions in classes
    {
      regex:
        /^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
      type: 'method',
    },
  ],
  javascript: [
    {
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/gm,
      type: 'function',
    },
    {
      regex:
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm,
      type: 'function',
    },
    {
      regex: /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/gm,
      type: 'class',
    },
    { regex: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm, type: 'method' },
  ],
  python: [
    { regex: /^(?:async\s+)?def\s+(\w+)\s*\([^)]*\)\s*(?:->[^:]+)?:/gm, type: 'function' },
    { regex: /^class\s+(\w+)(?:\([^)]*\))?:/gm, type: 'class' },
  ],
  go: [
    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)/gm, type: 'function' },
    { regex: /^type\s+(\w+)\s+struct\s*\{/gm, type: 'class' },
    { regex: /^type\s+(\w+)\s+interface\s*\{/gm, type: 'class' },
  ],
  rust: [
    {
      regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)/gm,
      type: 'function',
    },
    { regex: /^(?:pub\s+)?struct\s+(\w+)(?:<[^>]*>)?\s*\{/gm, type: 'class' },
    { regex: /^(?:pub\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{/gm, type: 'class' },
    { regex: /^impl(?:<[^>]*>)?\s+(?:\w+\s+for\s+)?(\w+)/gm, type: 'class' },
  ],
  java: [
    {
      regex:
        /^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm,
      type: 'function',
    },
    {
      regex:
        /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/gm,
      type: 'class',
    },
    { regex: /^(?:public\s+)?interface\s+(\w+)/gm, type: 'class' },
  ],
  ruby: [
    { regex: /^def\s+(\w+)(?:\([^)]*\))?/gm, type: 'function' },
    { regex: /^class\s+(\w+)(?:\s*<\s*\w+)?/gm, type: 'class' },
    { regex: /^module\s+(\w+)/gm, type: 'class' },
  ],
  php: [
    {
      regex:
        /^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)\s*\([^)]*\)/gm,
      type: 'function',
    },
    {
      regex: /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/gm,
      type: 'class',
    },
    { regex: /^interface\s+(\w+)/gm, type: 'class' },
  ],
  c: [
    { regex: /^(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm, type: 'function' },
    { regex: /^(?:typedef\s+)?struct\s+(\w+)\s*\{/gm, type: 'class' },
  ],
  cpp: [
    { regex: /^(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const)?\s*\{/gm, type: 'function' },
    { regex: /^class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+\w+)?\s*\{/gm, type: 'class' },
    { regex: /^struct\s+(\w+)\s*\{/gm, type: 'class' },
  ],
};

// Alias common extensions
LANGUAGE_PATTERNS['tsx'] = LANGUAGE_PATTERNS['typescript'];
LANGUAGE_PATTERNS['jsx'] = LANGUAGE_PATTERNS['javascript'];
LANGUAGE_PATTERNS['h'] = LANGUAGE_PATTERNS['c'];
LANGUAGE_PATTERNS['hpp'] = LANGUAGE_PATTERNS['cpp'];

/**
 * Code-aware chunker that splits source files into semantic units.
 */
export class CodeChunker {
  private config: ChunkerConfig;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  }

  /**
   * Chunk a source file into semantic units.
   */
  chunk(
    content: string,
    filePath: string,
    projectPath: string
  ): CodeChunk[] {
    const language = this.detectLanguage(filePath);
    const relativePath = path.relative(projectPath, filePath);
    const lines = content.split('\n');

    // Try semantic chunking first
    const patterns = LANGUAGE_PATTERNS[language];
    if (patterns && patterns.length > 0) {
      const semanticChunks = this.extractSemanticChunks(
        content,
        lines,
        filePath,
        relativePath,
        language,
        patterns
      );

      if (semanticChunks.length > 0) {
        return semanticChunks;
      }
    }

    // Fallback to fixed-size chunking
    return this.fixedChunk(content, lines, filePath, relativePath, language);
  }

  /**
   * Extract semantic chunks (functions, classes, etc.)
   */
  private extractSemanticChunks(
    content: string,
    lines: string[],
    filePath: string,
    relativePath: string,
    language: string,
    patterns: CodePattern[]
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const processedRanges: Array<{ start: number; end: number }> = [];

    for (const { regex, type } of patterns) {
      // Reset regex state
      regex.lastIndex = 0;

      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        const startOffset = match.index;
        const startLine = this.offsetToLine(content, startOffset);

        // Find the end of the block (matching braces or indentation)
        const endLine = this.findBlockEnd(lines, startLine, language);

        // Skip if this range overlaps with an already processed range
        const overlaps = processedRanges.some(
          (r) =>
            (startLine >= r.start && startLine <= r.end) ||
            (endLine >= r.start && endLine <= r.end)
        );
        if (overlaps) continue;

        // Extract the chunk content
        const chunkContent = lines.slice(startLine - 1, endLine).join('\n');

        // Skip if too small
        if (chunkContent.length < this.config.minChunkSize) continue;

        // If chunk is too large, split it
        if (chunkContent.length > this.config.maxChunkSize) {
          const subChunks = this.splitLargeChunk(
            chunkContent,
            filePath,
            relativePath,
            startLine,
            endLine,
            language,
            type,
            name
          );
          chunks.push(...subChunks);
        } else {
          chunks.push({
            id: this.generateId(filePath, startLine),
            content: chunkContent,
            filePath,
            relativePath,
            startLine,
            endLine,
            language,
            type,
            name,
          });
        }

        processedRanges.push({ start: startLine, end: endLine });
      }
    }

    // Sort by start line
    return chunks.sort((a, b) => a.startLine - b.startLine);
  }

  /**
   * Split a large chunk into smaller pieces.
   */
  private splitLargeChunk(
    content: string,
    filePath: string,
    relativePath: string,
    startLine: number,
    endLine: number,
    language: string,
    type: CodeChunk['type'],
    name: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const linesPerChunk = Math.ceil(
      this.config.maxChunkSize / (content.length / lines.length)
    );
    const overlapLines = Math.ceil(
      this.config.chunkOverlap / (content.length / lines.length)
    );

    for (let i = 0; i < lines.length; i += linesPerChunk - overlapLines) {
      const chunkStart = i;
      const chunkEnd = Math.min(i + linesPerChunk, lines.length);
      const chunkLines = lines.slice(chunkStart, chunkEnd);
      const chunkContent = chunkLines.join('\n');

      if (chunkContent.length >= this.config.minChunkSize) {
        chunks.push({
          id: this.generateId(filePath, startLine + chunkStart),
          content: chunkContent,
          filePath,
          relativePath,
          startLine: startLine + chunkStart,
          endLine: startLine + chunkEnd - 1,
          language,
          type: chunks.length === 0 ? type : 'block',
          name: chunks.length === 0 ? name : undefined,
        });
      }
    }

    return chunks;
  }

  /**
   * Fixed-size chunking fallback.
   */
  private fixedChunk(
    content: string,
    lines: string[],
    filePath: string,
    relativePath: string,
    language: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];

    // If file is small enough, return as single chunk
    if (content.length <= this.config.maxChunkSize) {
      return [
        {
          id: this.generateId(filePath, 1),
          content,
          filePath,
          relativePath,
          startLine: 1,
          endLine: lines.length,
          language,
          type: 'file',
        },
      ];
    }

    // Calculate lines per chunk
    const avgLineLength = content.length / lines.length;
    const linesPerChunk = Math.ceil(this.config.maxChunkSize / avgLineLength);
    const overlapLines = Math.ceil(this.config.chunkOverlap / avgLineLength);

    for (let i = 0; i < lines.length; i += linesPerChunk - overlapLines) {
      const startLine = i + 1;
      const endLine = Math.min(i + linesPerChunk, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');

      if (chunkContent.length >= this.config.minChunkSize) {
        chunks.push({
          id: this.generateId(filePath, startLine),
          content: chunkContent,
          filePath,
          relativePath,
          startLine,
          endLine,
          language,
          type: 'block',
        });
      }
    }

    return chunks;
  }

  /**
   * Find the end of a code block starting at the given line.
   */
  private findBlockEnd(
    lines: string[],
    startLine: number,
    language: string
  ): number {
    // For Python, use indentation-based detection
    if (language === 'python') {
      return this.findPythonBlockEnd(lines, startLine);
    }

    // For brace-based languages, count braces
    return this.findBraceBlockEnd(lines, startLine);
  }

  /**
   * Find block end using brace counting.
   */
  private findBraceBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundFirstBrace = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundFirstBrace = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundFirstBrace && braceCount === 0) {
        return i + 1;
      }
    }

    // If no closing brace found, return end of file
    return lines.length;
  }

  /**
   * Find block end using Python indentation.
   */
  private findPythonBlockEnd(lines: string[], startLine: number): number {
    const startIndent = this.getIndentation(lines[startLine - 1]);

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines and comments
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = this.getIndentation(line);

      // If we find a line with equal or less indentation, block ends
      if (indent <= startIndent && line.trim() !== '') {
        return i;
      }
    }

    return lines.length;
  }

  /**
   * Get the indentation level of a line.
   */
  private getIndentation(line: string): number {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') indent++;
      else if (char === '\t') indent += 4;
      else break;
    }
    return indent;
  }

  /**
   * Convert a character offset to a line number.
   */
  private offsetToLine(content: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  /**
   * Detect language from file extension.
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).slice(1).toLowerCase();

    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      mjs: 'javascript',
      cjs: 'javascript',
      py: 'python',
      pyw: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      rb: 'ruby',
      php: 'php',
      c: 'c',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      h: 'h',
      hpp: 'hpp',
      hxx: 'cpp',
      cs: 'csharp',
      swift: 'swift',
      kt: 'kotlin',
      kts: 'kotlin',
      scala: 'scala',
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
    };

    return langMap[ext] || 'text';
  }

  /**
   * Generate a unique chunk ID.
   */
  private generateId(filePath: string, startLine: number): string {
    return crypto
      .createHash('md5')
      .update(`${filePath}:${startLine}`)
      .digest('hex')
      .slice(0, 12);
  }
}
