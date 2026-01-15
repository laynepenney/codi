// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * E2E Test Utilities for MockProvider
 *
 * Helpers for setting up mock responses in E2E/PTY tests where
 * the provider runs in a separate process.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type { MockResponsesFile, MockResponse } from '../../src/providers/mock.js';
import type { ToolCall } from '../../src/types.js';

/**
 * Configuration for an E2E mock test session.
 */
export interface MockE2ESession {
  /** Path to the mock responses file */
  responsesFile: string;
  /** Path to the mock log file (optional) */
  logFile?: string;
  /** Temp directory for this session */
  tempDir: string;
  /** Environment variables to set */
  env: Record<string, string>;
}

/**
 * Create a temp directory for E2E test files.
 */
function createTempDir(prefix: string = 'codi-mock-e2e'): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Set up a mock E2E test session.
 *
 * Creates a temp directory with mock response files and returns
 * the environment variables needed to run Codi with the mock provider.
 *
 * @example
 * ```typescript
 * const session = setupMockE2E([
 *   { content: 'Hello! How can I help you today?' },
 *   { content: 'Sure, I can help with that.' },
 * ]);
 *
 * const pty = new PtyHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
 *   env: session.env,
 * });
 *
 * // ... run test ...
 *
 * cleanupMockE2E(session);
 * ```
 */
export function setupMockE2E(
  responses: MockResponse[],
  options?: {
    defaultResponse?: string;
    enableLogging?: boolean;
    config?: MockResponsesFile['config'];
  }
): MockE2ESession {
  const tempDir = createTempDir();
  const responsesFile = join(tempDir, 'responses.json');
  const logFile = options?.enableLogging ? join(tempDir, 'mock.log') : undefined;
  const historyFile = join(tempDir, 'history');

  const data: MockResponsesFile = {
    responses,
    defaultResponse: options?.defaultResponse,
    config: options?.config,
  };

  writeFileSync(responsesFile, JSON.stringify(data, null, 2));

  const env: Record<string, string> = {
    CODI_MOCK_FILE: responsesFile,
    CODI_HISTORY_FILE: historyFile, // Isolate history from real user history
  };

  if (logFile) {
    env.CODI_MOCK_LOG = logFile;
  }

  return {
    responsesFile,
    logFile,
    tempDir,
    env,
  };
}

/**
 * Clean up a mock E2E test session.
 */
export function cleanupMockE2E(session: MockE2ESession): void {
  try {
    rmSync(session.tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Read the mock log file to see what was sent/received.
 */
export function readMockLog(session: MockE2ESession): Array<{
  type: 'call' | 'response';
  timestamp: string;
  data: unknown;
}> {
  if (!session.logFile || !existsSync(session.logFile)) {
    return [];
  }

  const content = readFileSync(session.logFile, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

/**
 * Helper to create a simple text response.
 */
export function textResponse(content: string): MockResponse {
  return { content };
}

/**
 * Helper to create a tool use response.
 */
export function toolResponse(toolCalls: ToolCall[]): MockResponse {
  return { toolCalls, stopReason: 'tool_use' };
}

/**
 * Helper to create a tool call.
 */
export function toolCall(name: string, input: Record<string, unknown> = {}): ToolCall {
  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    input,
  };
}

/**
 * Create a conversation sequence with tool calls and results.
 *
 * This simulates a realistic multi-turn conversation where the AI
 * calls tools and responds based on results.
 *
 * @example
 * ```typescript
 * const session = setupMockE2E(conversationSequence([
 *   { ai: 'Let me read that file for you.' },
 *   { tool: 'read_file', input: { path: 'test.ts' } },
 *   { ai: 'The file contains a simple function.' },
 * ]));
 * ```
 */
export function conversationSequence(
  steps: Array<
    | { ai: string }
    | { tool: string; input?: Record<string, unknown> }
  >
): MockResponse[] {
  const responses: MockResponse[] = [];
  let pendingContent = '';

  for (const step of steps) {
    if ('ai' in step) {
      // Text response - may include pending tool call
      if (responses.length > 0 && responses[responses.length - 1].toolCalls) {
        // This is the response after a tool call
        responses.push({ content: step.ai });
      } else {
        // Accumulate text before potential tool call
        pendingContent = step.ai;
      }
    } else if ('tool' in step) {
      // Tool call response
      responses.push({
        content: pendingContent,
        toolCalls: [toolCall(step.tool, step.input || {})],
        stopReason: 'tool_use',
      });
      pendingContent = '';
    }
  }

  // Add any remaining text
  if (pendingContent) {
    responses.push({ content: pendingContent });
  }

  return responses;
}
