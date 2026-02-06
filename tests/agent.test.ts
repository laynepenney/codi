// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, type AgentOptions, type ToolConfirmation, type ConfirmationResult } from '../src/agent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { BaseTool } from '../src/tools/base.js';
import { MockProvider } from '../src/providers/mock.js';
import {
  createMockProvider,
  mockTextResponse,
  mockToolResponse,
  mockToolCall,
} from './helpers/mock-provider.js';
import { LogLevel } from '../src/logger.js';
import { TOOL_CATEGORIES, AGENT_CONFIG } from '../src/constants.js';
import { FIXED_CONFIG } from '../src/context-config.js';
import type { Message, ToolDefinition } from '../src/types.js';

// Test helper: simple tool implementation
class TestTool extends BaseTool {
  constructor(
    private _name: string,
    private _description: string = 'test tool',
    private _result: string = 'ok',
  ) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this._name,
      description: this._description,
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'File path' },
          command: { type: 'string', description: 'Command to run' },
          content: { type: 'string', description: 'Content' },
        },
        required: [],
      },
    };
  }

  async execute(): Promise<string> {
    return this._result;
  }
}

function createTestRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new TestTool('read_file', 'Read a file'));
  registry.register(new TestTool('write_file', 'Write a file'));
  registry.register(new TestTool('edit_file', 'Edit a file'));
  registry.register(new TestTool('bash', 'Run a command'));
  registry.register(new TestTool('glob', 'Find files'));
  registry.register(new TestTool('grep', 'Search files'));
  return registry;
}

describe('Agent', () => {
  let registry: ToolRegistry;
  let provider: MockProvider;

  beforeEach(() => {
    registry = createTestRegistry();
    provider = createMockProvider('Hello, I can help with that.');
  });

  describe('constructor', () => {
    it('creates agent with required options', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
      });
      expect(agent.getProvider()).toBe(provider);
      expect(agent.getHistory()).toEqual([]);
    });

    it('accepts custom system prompt', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        systemPrompt: 'You are a test assistant.',
      });
      expect(agent).toBeDefined();
    });

    it('handles autoApprove as true (approves all)', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        autoApprove: true,
      });
      // Agent created, autoApproveAll should be true
      expect(agent).toBeDefined();
    });

    it('handles autoApprove as string[] (approves specific tools)', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        autoApprove: ['read_file', 'glob'],
      });
      expect(agent).toBeDefined();
    });

    it('handles autoApprove as false/undefined (no auto approval)', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        autoApprove: false,
      });
      expect(agent).toBeDefined();
    });

    it('respects useTools option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        useTools: false,
      });
      expect(agent).toBeDefined();
    });

    it('respects extractToolsFromText option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        extractToolsFromText: false,
      });
      expect(agent).toBeDefined();
    });

    it('accepts approved bash patterns', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        approvedPatterns: [
          { pattern: '^git status$', approvedAt: new Date().toISOString() },
        ],
      });
      expect(agent).toBeDefined();
    });

    it('accepts approved bash categories', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        approvedCategories: ['git', 'npm'],
      });
      expect(agent).toBeDefined();
    });

    it('accepts approved path patterns', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        approvedPathPatterns: [
          { pattern: 'src/**/*.ts', toolName: 'write_file', approvedAt: new Date().toISOString() },
        ],
      });
      expect(agent).toBeDefined();
    });

    it('accepts approved path categories', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        approvedPathCategories: ['tests', 'src'],
      });
      expect(agent).toBeDefined();
    });

    it('accepts custom dangerous patterns', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        customDangerousPatterns: [
          { pattern: /deploy --prod/, description: 'Production deployment' },
        ],
      });
      expect(agent).toBeDefined();
    });

    it('handles logLevel option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        logLevel: LogLevel.DEBUG,
      });
      expect(agent).toBeDefined();
    });

    it('handles deprecated debug option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        debug: true,
      });
      expect(agent).toBeDefined();
    });

    it('accepts compression option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        enableCompression: true,
      });
      expect(agent.isCompressionEnabled()).toBe(true);
    });

    it('accepts maxContextTokens option', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        maxContextTokens: 50000,
      });
      const info = agent.getContextInfo();
      expect(info.maxTokens).toBe(50000);
    });

    it('accepts secondary provider', () => {
      const secondaryProvider = createMockProvider('Summary response');
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        secondaryProvider,
      });
      expect(agent).toBeDefined();
    });

    it('accepts callbacks', () => {
      const onText = vi.fn();
      const onToolCall = vi.fn();
      const onToolResult = vi.fn();
      const onConfirm = vi.fn().mockResolvedValue('approve');

      const agent = new Agent({
        provider,
        toolRegistry: registry,
        onText,
        onToolCall,
        onToolResult,
        onConfirm,
      });
      expect(agent).toBeDefined();
    });
  });

  describe('history management', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = new Agent({ provider, toolRegistry: registry });
    });

    it('starts with empty history', () => {
      expect(agent.getHistory()).toEqual([]);
    });

    it('setHistory replaces the conversation history', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      agent.setHistory(messages);
      expect(agent.getHistory()).toEqual(messages);
    });

    it('setHistory creates a copy of the messages', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      agent.setHistory(messages);
      messages.push({ role: 'assistant', content: 'Hi' });
      expect(agent.getHistory()).toHaveLength(1);
    });

    it('getHistory returns a copy of messages', () => {
      agent.setHistory([{ role: 'user', content: 'Hello' }]);
      const history = agent.getHistory();
      history.push({ role: 'assistant', content: 'Hi' });
      expect(agent.getHistory()).toHaveLength(1);
    });

    it('clearHistory removes all messages and summary', () => {
      agent.setHistory([{ role: 'user', content: 'Hello' }]);
      agent.setSummary('Previous conversation summary');
      agent.clearHistory();
      expect(agent.getHistory()).toEqual([]);
      expect(agent.getSummary()).toBeNull();
    });

    it('clearContext removes messages and summary but preserves working set', () => {
      agent.setHistory([{ role: 'user', content: 'Hello' }]);
      agent.setSummary('Previous conversation summary');
      // Working set is populated by tool calls, but we can check it's preserved
      agent.clearContext();
      expect(agent.getHistory()).toEqual([]);
      expect(agent.getSummary()).toBeNull();
      // Working set should still exist (not cleared)
      expect(agent.getContextInfo().workingSetFiles).toBe(0); // Was already 0, still 0
    });

    it('clearWorkingSet clears working set but preserves history and summary', () => {
      agent.setHistory([{ role: 'user', content: 'Hello' }]);
      agent.setSummary('Previous conversation summary');
      agent.clearWorkingSet();
      // History and summary should be preserved
      expect(agent.getHistory()).toHaveLength(1);
      expect(agent.getSummary()).toBe('Previous conversation summary');
      // Working set should be cleared
      expect(agent.getContextInfo().workingSetFiles).toBe(0);
    });
  });

  describe('summary management', () => {
    let agent: Agent;

    beforeEach(() => {
      agent = new Agent({ provider, toolRegistry: registry });
    });

    it('starts with null summary', () => {
      expect(agent.getSummary()).toBeNull();
    });

    it('setSummary stores the summary', () => {
      const summary = 'User asked about React. We discussed hooks.';
      agent.setSummary(summary);
      expect(agent.getSummary()).toBe(summary);
    });

    it('setSummary can set to null', () => {
      agent.setSummary('Some summary');
      agent.setSummary(null);
      expect(agent.getSummary()).toBeNull();
    });
  });

  describe('loadSession', () => {
    it('loads both messages and summary', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const messages: Message[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
      ];
      const summary = 'This is a session summary.';

      agent.loadSession(messages, summary);

      expect(agent.getHistory()).toEqual(messages);
      expect(agent.getSummary()).toBe(summary);
    });

    it('handles null summary', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.loadSession([{ role: 'user', content: 'Test' }], null);
      expect(agent.getSummary()).toBeNull();
    });
  });

  describe('provider management', () => {
    it('getProvider returns the current provider', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      expect(agent.getProvider()).toBe(provider);
    });

    it('setProvider switches to a new provider', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const newProvider = createMockProvider('New provider response');
      agent.setProvider(newProvider);
      expect(agent.getProvider()).toBe(newProvider);
    });

    it('setProvider preserves conversation history', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.setHistory([{ role: 'user', content: 'Hello' }]);
      const newProvider = createMockProvider('New response');
      agent.setProvider(newProvider);
      expect(agent.getHistory()).toHaveLength(1);
    });

    it('setProvider recalculates context limits if not explicitly set', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const originalInfo = agent.getContextInfo();

      // Create a new provider - context window depends on model name lookup
      const newProvider = new MockProvider({
        defaultResponse: 'Response',
        model: 'mock-model',
      });
      agent.setProvider(newProvider);

      const newInfo = agent.getContextInfo();
      // When maxContextTokens is not explicitly set, it's recalculated
      // The calculation depends on provider context window (model lookup)
      expect(newInfo.maxTokens).toBeGreaterThan(0);
    });

    it('setProvider preserves explicit maxContextTokens', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        maxContextTokens: 30000,
      });

      const largeProvider = new MockProvider({
        defaultResponse: 'Response',
        contextWindow: 200000,
      });
      agent.setProvider(largeProvider);

      expect(agent.getContextInfo().maxTokens).toBe(30000);
    });
  });

  describe('compression management', () => {
    it('compression is disabled by default', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      expect(agent.isCompressionEnabled()).toBe(false);
    });

    it('setCompression enables compression', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.setCompression(true);
      expect(agent.isCompressionEnabled()).toBe(true);
    });

    it('setCompression disables compression and clears stats', () => {
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        enableCompression: true,
      });
      agent.setCompression(false);
      expect(agent.isCompressionEnabled()).toBe(false);
    });
  });

  describe('context info', () => {
    it('returns complete context information', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const info = agent.getContextInfo();

      expect(info).toHaveProperty('tokens');
      expect(info).toHaveProperty('messageTokens');
      expect(info).toHaveProperty('systemPromptTokens');
      expect(info).toHaveProperty('toolDefinitionTokens');
      expect(info).toHaveProperty('maxTokens');
      expect(info).toHaveProperty('contextWindow');
      expect(info).toHaveProperty('outputReserve');
      expect(info).toHaveProperty('safetyBuffer');
      expect(info).toHaveProperty('tierName');
      expect(info).toHaveProperty('messages');
      expect(info).toHaveProperty('userMessages');
      expect(info).toHaveProperty('assistantMessages');
      expect(info).toHaveProperty('toolResultMessages');
      expect(info).toHaveProperty('hasSummary');
      expect(info).toHaveProperty('compression');
      expect(info).toHaveProperty('compressionEnabled');
      expect(info).toHaveProperty('workingSetFiles');
    });

    it('counts messages by role correctly', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.setHistory([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'Good!' },
      ]);

      const info = agent.getContextInfo();
      expect(info.messages).toBe(4);
      expect(info.userMessages).toBe(2);
      expect(info.assistantMessages).toBe(2);
    });

    it('tracks working set files', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      // Working set is internal, but we can verify it starts at 0
      const info = agent.getContextInfo();
      expect(info.workingSetFiles).toBe(0);
    });

    it('reflects summary presence', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      expect(agent.getContextInfo().hasSummary).toBe(false);

      agent.setSummary('Some summary');
      expect(agent.getContextInfo().hasSummary).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('returns a copy of messages', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      agent.setHistory(messages);

      const retrieved = agent.getMessages();
      expect(retrieved).toEqual(messages);

      // Verify it's a copy
      retrieved.push({ role: 'user', content: 'More' });
      expect(agent.getMessages()).toHaveLength(2);
    });
  });

  describe('injectContext', () => {
    it('adds background context as user message with acknowledgment', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const context = 'This is important background information.';

      agent.injectContext(context);

      const history = agent.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toContain('Background Context');
      expect(history[0].content).toContain(context);
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toContain('background context');
    });

    it('does nothing with empty context', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.injectContext('');
      expect(agent.getHistory()).toHaveLength(0);
    });
  });

  describe('setIndexedFiles', () => {
    it('sets indexed files for RAG scoring', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.setIndexedFiles(['src/index.ts', 'src/agent.ts']);
      // Files are stored internally, no direct getter
      expect(agent).toBeDefined();
    });
  });

  describe('model map routing', () => {
    it('getModelMap returns null when not configured', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      expect(agent.getModelMap()).toBeNull();
    });

    it('commandHasPipeline returns false when no model map', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      expect(agent.commandHasPipeline('refactor')).toBe(false);
    });

    it('getProviderForTask returns primary provider when no model map', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const taskProvider = agent.getProviderForTask('code');
      expect(taskProvider).toBe(provider);
    });

    it('getProviderForCommand returns primary provider when no model map', () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const cmdProvider = agent.getProviderForCommand('commit');
      expect(cmdProvider).toBe(provider);
    });
  });

  describe('chat method', () => {
    it('adds user message to history', async () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      await agent.chat('Hello there');

      const history = agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello there');
    });

    it('returns assistant response', async () => {
      provider = createMockProvider('This is my response.');
      const agent = new Agent({ provider, toolRegistry: registry });

      const response = await agent.chat('Hello');
      expect(response).toBe('This is my response.');
    });

    it('stores assistant message in history', async () => {
      provider = createMockProvider('Response text');
      const agent = new Agent({ provider, toolRegistry: registry });

      await agent.chat('Hello');

      const history = agent.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].role).toBe('assistant');
    });

    it('calls onText callback with response chunks', async () => {
      const onText = vi.fn();
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        onText,
      });

      await agent.chat('Hello');
      expect(onText).toHaveBeenCalled();
    });

    it('handles tool calls and results', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('read_file', { path: 'test.ts' })]),
        mockTextResponse('File contents analyzed.'),
      ]);

      const onToolCall = vi.fn();
      const onToolResult = vi.fn();

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onToolCall,
        onToolResult,
        autoApprove: true,
      });

      const response = await agent.chat('Read test.ts');

      expect(onToolCall).toHaveBeenCalledWith('read_file', { path: 'test.ts' });
      expect(onToolResult).toHaveBeenCalled();
      expect(response).toBe('File contents analyzed.');
    });

    it('requests confirmation for destructive tools', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('write_file', { path: 'new.ts', content: 'code' })]),
        mockTextResponse('File written.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('approve' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Write a file');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      expect(confirmation.toolName).toBe('write_file');
    });

    it('skips confirmation for safe tools', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('read_file', { path: 'test.ts' })]),
        mockTextResponse('Read complete.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('approve' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Read test.ts');

      // read_file is not destructive, so no confirmation
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('skips confirmation when autoApprove is true', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('write_file', { path: 'new.ts', content: 'code' })]),
        mockTextResponse('Done.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('approve' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: true,
        onConfirm,
      });

      await agent.chat('Write a file');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('skips confirmation for specifically auto-approved tools', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'ls' })]),
        mockTextResponse('Done.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('approve' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: ['bash'],
        onConfirm,
      });

      await agent.chat('Run ls');
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('handles user deny response', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('write_file', { path: 'bad.ts', content: 'code' })]),
        mockTextResponse('Understood, not writing.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('deny' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Write a bad file');
      expect(onConfirm).toHaveBeenCalled();
    });

    it('handles user abort response', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('write_file', { path: 'test.ts', content: 'code' })]),
        mockTextResponse('Operation aborted.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('abort' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      const response = await agent.chat('Write a file');
      expect(response).toContain('aborted');
    });

    it('handles approve_pattern response', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'npm test' })]),
        mockTextResponse('Tests passed.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue({
        type: 'approve_pattern',
        pattern: '^npm test$',
      } as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Run npm test');
      expect(onConfirm).toHaveBeenCalled();
    });

    it('handles approve_category response', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'git status' })]),
        mockTextResponse('Git status shown.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue({
        type: 'approve_category',
        categoryId: 'git',
      } as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Git status');
      expect(onConfirm).toHaveBeenCalled();
    });

    it('stops after MAX_CONSECUTIVE_ERRORS', async () => {
      // Create a provider that returns errors
      const errorProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'fail1' })]),
        mockToolResponse([mockToolCall('bash', { command: 'fail2' })]),
        mockToolResponse([mockToolCall('bash', { command: 'fail3' })]),
        mockTextResponse('Gave up.'),
      ]);

      // Create registry with tool that always errors
      const errorRegistry = new ToolRegistry();
      class ErrorTool extends BaseTool {
        getDefinition() {
          return {
            name: 'bash',
            description: 'Run command',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
          };
        }
        async execute(): Promise<string> {
          throw new Error('Command failed');
        }
      }
      errorRegistry.register(new ErrorTool());

      const agent = new Agent({
        provider: errorProvider,
        toolRegistry: errorRegistry,
        autoApprove: true,
      });

      const response = await agent.chat('Run commands');
      expect(response).toContain('repeated errors');
    });
  });

  describe('forceCompact', () => {
    it('returns before/after token counts', async () => {
      const agent = new Agent({ provider, toolRegistry: registry });

      // Add some messages
      const messages: Message[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Question ${i}: What is ${'x'.repeat(100)}?` });
        messages.push({ role: 'assistant', content: `Answer ${i}: The value is ${'y'.repeat(100)}.` });
      }
      agent.setHistory(messages);

      const result = await agent.forceCompact();
      expect(result).toHaveProperty('before');
      expect(result).toHaveProperty('after');
      expect(result).toHaveProperty('summary');
      expect(result.before).toBeGreaterThan(0);
    });

    it('does not compact if too few messages', async () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      agent.setHistory([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ]);

      const result = await agent.forceCompact();
      expect(result.before).toBe(result.after);
    });
  });

  describe('constants integration', () => {
    it('uses FIXED_CONFIG values', () => {
      expect(FIXED_CONFIG.MAX_MESSAGES).toBe(500);
      expect(FIXED_CONFIG.MAX_CHAT_DURATION_MS).toBe(60 * 60 * 1000);
      expect(FIXED_CONFIG.MAX_ITERATIONS).toBe(2000);
    });

    it('identifies destructive tools correctly', () => {
      expect(TOOL_CATEGORIES.DESTRUCTIVE.has('write_file')).toBe(true);
      expect(TOOL_CATEGORIES.DESTRUCTIVE.has('edit_file')).toBe(true);
      expect(TOOL_CATEGORIES.DESTRUCTIVE.has('bash')).toBe(true);
      expect(TOOL_CATEGORIES.DESTRUCTIVE.has('read_file')).toBe(false);
    });

    it('identifies safe tools correctly', () => {
      expect(TOOL_CATEGORIES.SAFE.has('read_file')).toBe(true);
      expect(TOOL_CATEGORIES.SAFE.has('glob')).toBe(true);
      expect(TOOL_CATEGORIES.SAFE.has('grep')).toBe(true);
      expect(TOOL_CATEGORIES.SAFE.has('write_file')).toBe(false);
    });
  });

  describe('bash command normalization', () => {
    it('normalizes cmd array format to command', async () => {
      const toolProvider = createMockProvider([
        // Model sends non-standard format
        {
          toolCalls: [{
            id: 'call_1',
            name: 'bash',
            input: { cmd: ['bash', '-lc', 'echo hello'] },
          }],
          stopReason: 'tool_use',
        },
        mockTextResponse('Done.'),
      ]);

      const onToolCall = vi.fn();
      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: true,
        onToolCall,
      });

      await agent.chat('Echo hello');

      // The tool call should have been normalized
      expect(onToolCall).toHaveBeenCalled();
    });

    it('normalizes cmd string format to command', async () => {
      const toolProvider = createMockProvider([
        {
          toolCalls: [{
            id: 'call_1',
            name: 'bash',
            input: { cmd: 'ls -la' },
          }],
          stopReason: 'tool_use',
        },
        mockTextResponse('Listed.'),
      ]);

      const onToolCall = vi.fn();
      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: true,
        onToolCall,
      });

      await agent.chat('List files');
      expect(onToolCall).toHaveBeenCalled();
    });
  });

  describe('dangerous bash detection', () => {
    it('flags dangerous bash commands', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'rm -rf /' })]),
        mockTextResponse('Dangerous command handled.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('deny' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Delete everything');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      expect(confirmation.isDangerous).toBe(true);
      expect(confirmation.dangerReason).toBeDefined();
    });

    it('requires confirmation for dangerous bash even when auto-approved', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'rm -rf /' })]),
        mockTextResponse('Dangerous command handled.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('deny' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: true,
        onConfirm,
      });

      await agent.chat('Delete everything');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      expect(confirmation.isDangerous).toBe(true);
    });

    it('flags custom dangerous patterns', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'deploy --prod' })]),
        mockTextResponse('Deploy handled.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('deny' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        customDangerousPatterns: [
          { pattern: /deploy --prod/, description: 'Production deployment' },
        ],
        onConfirm,
      });

      await agent.chat('Deploy to prod');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      expect(confirmation.isDangerous).toBe(true);
      expect(confirmation.dangerReason).toBe('Production deployment');
    });

    it('requires confirmation for custom dangerous patterns even when bash is auto-approved', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('bash', { command: 'deploy --prod' })]),
        mockTextResponse('Deploy handled.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('deny' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        autoApprove: ['bash'],
        customDangerousPatterns: [
          { pattern: /deploy --prod/, description: 'Production deployment' },
        ],
        onConfirm,
      });

      await agent.chat('Deploy to prod');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      expect(confirmation.isDangerous).toBe(true);
      expect(confirmation.dangerReason).toBe('Production deployment');
    });
  });

  describe('diff preview generation', () => {
    it('includes diff preview for write_file operations', async () => {
      const toolProvider = createMockProvider([
        mockToolResponse([mockToolCall('write_file', { path: '/tmp/test.ts', content: 'new content' })]),
        mockTextResponse('Written.'),
      ]);

      const onConfirm = vi.fn().mockResolvedValue('approve' as ConfirmationResult);

      const agent = new Agent({
        provider: toolProvider,
        toolRegistry: registry,
        onConfirm,
      });

      await agent.chat('Write a file');

      expect(onConfirm).toHaveBeenCalled();
      const confirmation = onConfirm.mock.calls[0][0] as ToolConfirmation;
      // Diff preview is attempted but may not always succeed (file may not exist)
      expect(confirmation.toolName).toBe('write_file');
    });
  });

  describe('reasoning callbacks', () => {
    it('accepts onReasoning callback option', () => {
      // MockProvider doesn't support reasoningContent, but Agent should accept the option
      const onReasoning = vi.fn();
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        onReasoning,
      });
      expect(agent).toBeDefined();
    });

    it('accepts onReasoningChunk callback option', () => {
      // MockProvider doesn't support reasoning chunks, but Agent should accept the option
      const onReasoningChunk = vi.fn();
      const agent = new Agent({
        provider,
        toolRegistry: registry,
        onReasoningChunk,
      });
      expect(agent).toBeDefined();
    });
  });

  describe('task type routing', () => {
    it('accepts taskType option in chat', async () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      const response = await agent.chat('Hello', { taskType: 'fast' });
      expect(response).toBeDefined();
    });

    it('uses primary provider when no model map for task routing', async () => {
      const agent = new Agent({ provider, toolRegistry: registry });
      // Without model map, task type has no effect
      await agent.chat('Hello', { taskType: 'complex' });
      // Verify it still works
      expect(agent.getHistory()).toHaveLength(2);
    });
  });
});
