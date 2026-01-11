import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunTestsTool } from '../src/tools/run-tests.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock child_process.exec to avoid actually running tests during testing
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    exec: vi.fn((_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      // Default implementation - will be overridden in tests
      callback(null, '', '');
    })
  };
});

// Import child_process after mocking to get the mocked version
import { exec } from 'child_process';

// Helper to mock exec with promisify behavior
function mockExecSuccess(stdout: string, stderr: string = '') {
  (exec as unknown as vi.Mock).mockImplementation(
    (_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      // Handle both callback and promise-based usage
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, stdout, stderr));
      }
      return { stdout, stderr };
    }
  );
}

function mockExecFailure(code: number, stdout: string, stderr: string) {
  (exec as unknown as vi.Mock).mockImplementation(
    (_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      if (typeof callback === 'function') {
        const error = new Error('Command failed') as Error & { code: number; stdout: string; stderr: string };
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        process.nextTick(() => callback(error, stdout, stderr));
      }
    }
  );
}

function mockExecTimeout() {
  (exec as unknown as vi.Mock).mockImplementation(
    (_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      if (typeof callback === 'function') {
        const error = new Error('Timeout') as Error & { killed: boolean; signal: string };
        error.killed = true;
        error.signal = 'SIGTERM';
        process.nextTick(() => callback(error, '', ''));
      }
    }
  );
}

// Mock process.cwd to control current working directory
const mockCwd = vi.spyOn(process, 'cwd');

describe('RunTestsTool', () => {
  let tool: RunTestsTool;
  let testDir: string;

  beforeEach(() => {
    tool = new RunTestsTool();
    testDir = join(tmpdir(), `.codi-run-tests-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
    mockCwd.mockReturnValue(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mockCwd.mockRestore();
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('run_tests');
      expect(def.description).toContain('Run project tests');
      expect(def.input_schema.properties).toHaveProperty('filter');
      expect(def.input_schema.properties).toHaveProperty('timeout');
      expect(def.input_schema.required).toHaveLength(0);
    });
  });

  describe('execute', () => {
    it('detects npm script test runner', async () => {
      // Create package.json with test script
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      }));

      mockExecSuccess('Tests passed');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'npm test',
        expect.objectContaining({
          cwd: testDir,
          timeout: 60000
        }),
        expect.any(Function)
      );
      // Verify we got a formatted result (mock output not reliably passed through promisify)
      expect(result).toContain('npm test');
      expect(result).toContain('PASSED');
    });

    it('detects yarn script test runner', async () => {
      // Create package.json with test script and yarn lock file
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'jest'
        }
      }));
      writeFileSync(join(testDir, 'yarn.lock'), '');

      mockExecSuccess('Jest tests passed');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'yarn test',
        expect.objectContaining({
          cwd: testDir,
          timeout: 60000
        }),
        expect.any(Function)
      );
      expect(result).toContain('yarn test');
      expect(result).toContain('PASSED');
    });

    it('detects pnpm script test runner', async () => {
      // Create package.json with test script and pnpm lock file
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      }));
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');

      mockExecSuccess('Vitest tests passed');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'pnpm test',
        expect.objectContaining({
          cwd: testDir,
          timeout: 60000
        }),
        expect.any(Function)
      );
      expect(result).toContain('pnpm test');
      expect(result).toContain('PASSED');
    });

    it('uses direct pytest for Python projects', async () => {
      // Create requirements.txt to indicate Python project
      writeFileSync(join(testDir, 'requirements.txt'), 'pytest\n');

      mockExecSuccess('Python tests passed');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'python -m pytest',
        expect.objectContaining({
          cwd: testDir,
          timeout: 60000
        }),
        expect.any(Function)
      );
      expect(result).toContain('python -m pytest');
      expect(result).toContain('PASSED');
    });

    it('uses direct pytest with filter when specified', async () => {
      writeFileSync(join(testDir, 'requirements.txt'), 'pytest\n');

      mockExecSuccess('Filtered test passed');

      const result = await tool.execute({ filter: 'test_something', cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'python -m pytest -k test_something',
        expect.objectContaining({
          cwd: testDir,
          timeout: 60000
        }),
        expect.any(Function)
      );
      expect(result).toContain('python -m pytest -k test_something');
      expect(result).toContain('PASSED');
    });

    it('uses custom timeout when specified', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      }));

      mockExecSuccess('Tests passed');

      const result = await tool.execute({ timeout: 30, cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'npm test',
        expect.objectContaining({
          cwd: testDir,
          timeout: 30000
        }),
        expect.any(Function)
      );
      expect(result).toContain('npm test');
      expect(result).toContain('PASSED');
    });

    it('handles test failures', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      }));

      mockExecFailure(1, '', 'Test failed');

      const result = await tool.execute({ cwd: testDir });
      expect(result).toContain('FAILED');
    });

    it('handles timeout', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      }));

      mockExecTimeout();

      await expect(tool.execute({ cwd: testDir }))
        .rejects.toThrow('Test execution timed out');
    });

    it('handles projects with no test configuration', async () => {
      // Empty directory with no config files - should throw error
      await expect(tool.execute({ cwd: testDir }))
        .rejects.toThrow('Could not detect test runner');
    });

    it('detects Go projects', async () => {
      writeFileSync(join(testDir, 'go.mod'), 'module example.com/test\n\ngo 1.21\n');

      mockExecSuccess('ok  example.com/test 0.001s');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'go test ./...',
        expect.objectContaining({
          cwd: testDir
        }),
        expect.any(Function)
      );
      expect(result).toContain('go test');
      expect(result).toContain('PASSED');
    });

    it('detects Rust projects', async () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "test"\nversion = "0.1.0"\n');

      mockExecSuccess('test result: ok. 1 passed; 0 failed');

      const result = await tool.execute({ cwd: testDir });

      expect(exec).toHaveBeenCalledWith(
        'cargo test',
        expect.objectContaining({
          cwd: testDir
        }),
        expect.any(Function)
      );
      expect(result).toContain('cargo test');
      expect(result).toContain('PASSED');
    });

    it('uses custom command when specified', async () => {
      mockExecSuccess('Custom test output');

      const result = await tool.execute({
        command: 'npm run test:integration',
        cwd: testDir
      });

      expect(exec).toHaveBeenCalledWith(
        'npm run test:integration',
        expect.objectContaining({
          cwd: testDir
        }),
        expect.any(Function)
      );
      expect(result).toContain('npm run test:integration');
      expect(result).toContain('PASSED');
    });
  });
});