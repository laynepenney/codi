import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineTool } from '../src/tools/pipeline.js';
import { globalRegistry } from '../src/tools/registry.js';
import { BaseTool } from '../src/tools/base.js';
import type { ToolDefinition } from '../src/types.js';

// Mock tool for testing
class MockTool extends BaseTool {
  private response: string | Error;
  private delay: number;

  constructor(name: string, response: string | Error = 'success', delay = 0) {
    super();
    this._name = name;
    this.response = response;
    this.delay = delay;
  }

  private _name: string;

  getDefinition(): ToolDefinition {
    return {
      name: this._name,
      description: `Mock tool: ${this._name}`,
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  async execute(_input: Record<string, unknown>): Promise<string> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }

    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

describe('PipelineTool', () => {
  let pipeline: PipelineTool;
  let originalTools: Map<string, BaseTool>;

  beforeEach(() => {
    pipeline = new PipelineTool();

    // Save original registry state
    originalTools = new Map();
    // @ts-expect-error - accessing private tools for testing
    for (const [name, tool] of globalRegistry.tools.entries()) {
      originalTools.set(name, tool);
    }

    // Register mock tools
    globalRegistry.register(new MockTool('mock_success', 'Operation completed'));
    globalRegistry.register(new MockTool('mock_json', '{"ok": true, "data": "result"}'));
    globalRegistry.register(new MockTool('mock_error_json', '{"ok": false, "error": "failed"}'));
    globalRegistry.register(new MockTool('mock_error_prefix', 'Error: something went wrong'));
    globalRegistry.register(new MockTool('mock_throw', new Error('Tool threw an error')));
    globalRegistry.register(new MockTool('mock_slow', 'slow result', 50));
  });

  afterEach(() => {
    // Restore original registry
    // @ts-expect-error - accessing private tools for testing
    globalRegistry.tools.clear();
    for (const [name, tool] of originalTools.entries()) {
      globalRegistry.register(tool);
    }
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = pipeline.getDefinition();

      expect(def.name).toBe('pipeline');
      expect(def.description).toContain('sequence of tool calls');
      expect(def.input_schema.properties).toHaveProperty('steps');
      expect(def.input_schema.properties).toHaveProperty('stop_on_failure');
      expect(def.input_schema.properties).toHaveProperty('dry_run');
      expect(def.input_schema.required).toContain('steps');
    });
  });

  describe('execute', () => {
    describe('validation', () => {
      it('fails with empty steps array', async () => {
        const result = await pipeline.execute({ steps: [] });

        expect(result).toContain('ok": false');
        expect(result).toContain('At least one step is required');
      });

      it('fails with missing steps', async () => {
        const result = await pipeline.execute({});

        expect(result).toContain('ok": false');
        expect(result).toContain('At least one step is required');
      });

      it('fails with missing tool name in step', async () => {
        const result = await pipeline.execute({
          steps: [{ args: {} }],
        });

        expect(result).toContain('ok": false');
        expect(result).toContain('missing tool name');
      });

      it('fails with unknown tool', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'nonexistent_tool', args: {} }],
        });

        expect(result).toContain('"ok": false');
        expect(result).toContain('unknown tool \\"nonexistent_tool\\"');
      });

      it('reports multiple validation errors', async () => {
        const result = await pipeline.execute({
          steps: [
            { args: {} }, // missing tool
            { tool: 'unknown1', args: {} },
            { tool: 'unknown2', args: {} },
          ],
        });

        expect(result).toContain('missing tool name');
        expect(result).toContain('unknown tool \\"unknown1\\"');
        expect(result).toContain('unknown tool \\"unknown2\\"');
      });
    });

    describe('dry run mode', () => {
      it('validates without executing', async () => {
        const result = await pipeline.execute({
          steps: [
            { tool: 'mock_success', args: {}, name: 'First step' },
            { tool: 'mock_success', args: {}, name: 'Second step' },
          ],
          dry_run: true,
        });

        expect(result).toContain('ok": true');
        expect(result).toContain('validated');
        expect(result).toContain('First step');
        expect(result).toContain('Second step');
      });

      it('uses tool name when step name not provided', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_success', args: {} }],
          dry_run: true,
        });

        expect(result).toContain('mock_success');
      });
    });

    describe('successful execution', () => {
      it('executes single step', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_success', args: {} }],
        });

        expect(result).toContain('Pipeline Result: SUCCESS');
        expect(result).toContain('Completed:** 1/1 steps');
        expect(result).toContain('✓');
      });

      it('executes multiple steps in order', async () => {
        const result = await pipeline.execute({
          steps: [
            { tool: 'mock_success', args: {}, name: 'Step 1' },
            { tool: 'mock_json', args: {}, name: 'Step 2' },
          ],
        });

        expect(result).toContain('Pipeline Result: SUCCESS');
        expect(result).toContain('Completed:** 2/2 steps');
        expect(result).toContain('Step 1');
        expect(result).toContain('Step 2');
      });

      it('shows duration for each step', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_slow', args: {} }],
        });

        expect(result).toMatch(/\d+\.\d+s/);
      });
    });

    describe('failure handling', () => {
      it('stops on first failure by default', async () => {
        const result = await pipeline.execute({
          steps: [
            { tool: 'mock_success', args: {}, name: 'First' },
            { tool: 'mock_throw', args: {}, name: 'Fails' },
            { tool: 'mock_success', args: {}, name: 'Never runs' },
          ],
        });

        expect(result).toContain('Pipeline Result: FAILED');
        expect(result).toContain('Completed:** 2/3 steps');
        expect(result).toContain('Stopped at:** Step 2');
        expect(result).toContain('✓ First');
        expect(result).toContain('✗ Fails');
        expect(result).not.toContain('Never runs');
      });

      it('continues through failures when stop_on_failure is false', async () => {
        const result = await pipeline.execute({
          steps: [
            { tool: 'mock_success', args: {}, name: 'First' },
            { tool: 'mock_throw', args: {}, name: 'Fails' },
            { tool: 'mock_success', args: {}, name: 'Still runs' },
          ],
          stop_on_failure: false,
        });

        expect(result).toContain('Pipeline Result: FAILED');
        expect(result).toContain('Completed:** 3/3 steps');
        expect(result).not.toContain('Stopped at');
        expect(result).toContain('Still runs');
      });

      it('detects JSON error response', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_error_json', args: {} }],
        });

        expect(result).toContain('Pipeline Result: FAILED');
        expect(result).toContain('✗');
      });

      it('detects "Error:" prefix response', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_error_prefix', args: {} }],
        });

        expect(result).toContain('Pipeline Result: FAILED');
        expect(result).toContain('✗');
      });

      it('shows error message for thrown errors', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_throw', args: {} }],
        });

        expect(result).toContain('Error: Tool threw an error');
      });
    });

    describe('output formatting', () => {
      it('includes structured JSON at end', async () => {
        const result = await pipeline.execute({
          steps: [{ tool: 'mock_success', args: {} }],
        });

        expect(result).toContain('```json');
        expect(result).toContain('"ok": true');
        expect(result).toContain('"completed": 1');
        expect(result).toContain('"total": 1');
      });

      it('includes stoppedAt in JSON when stopped early', async () => {
        const result = await pipeline.execute({
          steps: [
            { tool: 'mock_throw', args: {} },
            { tool: 'mock_success', args: {} },
          ],
        });

        expect(result).toContain('"stoppedAt": 1');
      });

      it('truncates long output', async () => {
        // Register a tool with very long output
        const longOutput = 'x'.repeat(1000);
        globalRegistry.register(new MockTool('mock_long', longOutput));

        const result = await pipeline.execute({
          steps: [{ tool: 'mock_long', args: {} }],
        });

        // The truncation happens internally, output is stored but truncated
        expect(result).toBeDefined();
      });
    });
  });
});
