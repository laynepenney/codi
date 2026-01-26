// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fast Scan for Two-Pass Analysis
 *
 * Performs a quick scan of files to identify which need deep analysis.
 * Uses a simpler prompt and faster model for efficiency.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { BaseProvider } from '../providers/base.js';
import type { FastScanResult, TwoPassOptions, CodebaseStructure } from './types.js';
import type { ContentBlock } from '../types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import { processInParallel } from './grouping.js';

/** Maximum file size for scanning (30KB) */
const MAX_SCAN_SIZE = 30000;

/** Fast scan prompt - kept minimal for speed */
const FAST_SCAN_PROMPT = `Quickly assess this code file. Respond with JSON ONLY:

{"score": 0-10, "flags": ["flag1"], "summary": "one-line", "needsDeep": true/false}

Score guide:
- 0-3: Simple, no issues (skip deep)
- 4-6: Moderate complexity or minor issues (maybe deep)
- 7-10: Complex, security concerns, or major issues (needs deep)

Flags to check: security, complexity, error-handling, performance, architecture

FILE:
\`\`\`
{content}
\`\`\``;

/**
 * Parse fast scan response to extract score and flags
 */
function parseFastScanResponse(response: string, file: string): FastScanResult {
  // Try to find JSON in the response
  const jsonMatch = response.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        file,
        score: Math.min(10, Math.max(0, Number(parsed.score) || 0)),
        flags: Array.isArray(parsed.flags) ? parsed.flags : [],
        summary: String(parsed.summary || '').slice(0, 100),
        needsDeep: Boolean(parsed.needsDeep),
      };
    } catch {
      // Fall through to default
    }
  }

  // Default: moderate score if parsing fails
  return {
    file,
    score: 5,
    flags: [],
    summary: 'Unable to parse scan result',
    needsDeep: true,
  };
}

/**
 * Run fast scan on a single file
 */
async function scanFile(
  file: string,
  provider: BaseProvider
): Promise<FastScanResult> {
  try {
    // Check file size
    const stats = statSync(file);
    if (stats.size > MAX_SCAN_SIZE) {
      return {
        file,
        score: 7, // Large files should get deep analysis
        flags: ['large-file'],
        summary: `Large file (${Math.round(stats.size / 1024)}KB)`,
        needsDeep: true,
      };
    }

    // Read file content
    const content = readFileSync(file, 'utf-8');

    // Quick heuristics before API call
    const lineCount = content.split('\n').length;
    if (lineCount < 20) {
      return {
        file,
        score: 1,
        flags: ['small-file'],
        summary: 'Small file',
        needsDeep: false,
      };
    }

    // Check for obvious patterns that need deep analysis
    const hasSecurityPatterns = /password|secret|token|auth|crypto/i.test(content);
    const hasComplexPatterns = /class\s+\w+.*extends|async\s+\*?function|Promise\.all/i.test(content);

    if (hasSecurityPatterns) {
      return {
        file,
        score: 8,
        flags: ['security'],
        summary: 'Contains security-sensitive patterns',
        needsDeep: true,
      };
    }

    // Build prompt
    const prompt = FAST_SCAN_PROMPT.replace('{content}', content.slice(0, MAX_SCAN_SIZE));

    // Call provider
    const response = await provider.chat([
      { role: 'user', content: prompt },
    ]);

    const responseText = typeof response.content === 'string'
      ? response.content
      : (response.content as ContentBlock[]).map((b) => (b.type === 'text' ? b.text : '')).join('');

    return parseFastScanResponse(responseText, file);
  } catch (error) {
    // On error, mark for deep analysis to be safe
    return {
      file,
      score: 5,
      flags: ['scan-error'],
      summary: error instanceof Error ? error.message.slice(0, 50) : 'Unknown error',
      needsDeep: true,
    };
  }
}

/**
 * Run fast scan on multiple files in parallel
 */
export async function fastScanFiles(
  files: string[],
  registry: ModelRegistry,
  router: TaskRouter,
  options: TwoPassOptions & {
    providerContext?: string;
    concurrency?: number;
    onProgress?: (scanned: number, total: number, file: string) => void;
    onScanComplete?: (result: FastScanResult) => void;
  }
): Promise<FastScanResult[]> {
  // Get fast model provider
  const roleName = options.fastRole || 'fast';
  const resolved = router.resolveRole(roleName, options.providerContext || 'ollama');

  if (!resolved) {
    throw new Error(`No model found for role '${roleName}'`);
  }

  const provider = await registry.getProvider(resolved.name);
  const concurrency = options.concurrency || 4;

  // Scan files in parallel
  const results = await processInParallel(
    files,
    async (file, index) => {
      options.onProgress?.(index, files.length, file);
      const result = await scanFile(file, provider);
      options.onScanComplete?.(result);
      return result;
    },
    concurrency
  );

  return results;
}

/**
 * Select files for deep analysis based on fast scan results
 */
export function selectFilesForDeepAnalysis(
  scanResults: FastScanResult[],
  options: TwoPassOptions
): { deep: string[]; shallow: string[] } {
  const threshold = options.deepThreshold ?? 5;
  const maxDeepPercent = options.maxDeepPercent ?? 30;
  const maxDeepCount = Math.ceil(scanResults.length * (maxDeepPercent / 100));

  // Sort by score descending
  const sorted = [...scanResults].sort((a, b) => b.score - a.score);

  // Select files above threshold, up to max count
  const deep: string[] = [];
  const shallow: string[] = [];

  for (const result of sorted) {
    if (result.needsDeep || result.score >= threshold) {
      if (deep.length < maxDeepCount) {
        deep.push(result.file);
      } else {
        shallow.push(result.file);
      }
    } else {
      shallow.push(result.file);
    }
  }

  return { deep, shallow };
}

/**
 * Build aggregated context from shallow scan results
 */
export function buildShallowContext(
  scanResults: FastScanResult[]
): string {
  const lines: string[] = [];
  lines.push('## Files with shallow scan (not analyzed in depth):');
  lines.push('');

  for (const result of scanResults) {
    const flags = result.flags.length > 0 ? ` [${result.flags.join(', ')}]` : '';
    lines.push(`- ${basename(result.file)}: ${result.summary}${flags}`);
  }

  return lines.join('\n');
}
