// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed helper for mocking child_process.exec in tests.
 *
 * IMPORTANT: Node's `exec` has a custom `[util.promisify.custom]` implementation
 * that transforms `(err, stdout, stderr)` callbacks to `{ stdout, stderr }` objects.
 * When we mock `exec`, we lose this custom behavior, so standard `promisify`
 * expects `(err, result)` format. Therefore, our mocks pass `{ stdout, stderr }`
 * as the second callback argument.
 */

import type { ChildProcess, ExecException, ExecOptions } from 'child_process';

/**
 * Result of a mocked command execution.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Error result of a mocked command execution.
 */
export interface ExecError {
  error: ExecException;
  stdout: string;
  stderr: string;
}

/**
 * Type for the exec callback when mocking with promisify.
 * Note: We pass { stdout, stderr } as result because mocked exec
 * loses Node's custom promisify behavior.
 */
export type MockExecCallback = (
  error: ExecException | null,
  result: ExecResult
) => void;

/**
 * Type for the mocked exec function.
 */
export type MockedExecFn = (
  command: string,
  options: ExecOptions | undefined | null,
  callback?: MockExecCallback
) => ChildProcess;

/**
 * Minimal ChildProcess mock for return value.
 */
const MOCK_CHILD_PROCESS = {
  pid: 0,
  stdin: null,
  stdout: null,
  stderr: null,
  stdio: [null, null, null],
  killed: false,
  exitCode: null,
  signalCode: null,
  spawnargs: [],
  spawnfile: '',
} as unknown as ChildProcess;

/**
 * Create a successful exec result.
 */
export function execSuccess(stdout: string, stderr = ''): ExecResult {
  return { stdout, stderr };
}

/**
 * Create an error exec result.
 */
export function execError(message: string, stdout = '', stderr = ''): ExecError {
  const error = new Error(message) as ExecException;
  error.code = 1;
  return { error, stdout, stderr };
}

/**
 * Create a mock implementation for child_process.exec that returns predetermined results.
 *
 * @param results - Map of command strings to their results (success or error)
 * @param defaultResult - Optional default result for unmatched commands
 * @returns A function suitable for use with vi.mocked(exec).mockImplementation()
 *
 * @example
 * ```typescript
 * const mockImpl = createExecMock(
 *   new Map([
 *     ['node -v', execSuccess('v20.0.0')],
 *     ['npm -v', execSuccess('10.0.0')],
 *     ['bad-cmd', execError('Command not found')],
 *   ])
 * );
 *
 * vi.mocked(exec).mockImplementation(mockImpl);
 * ```
 */
export function createExecMock(
  results: Map<string, ExecResult | ExecError>,
  defaultResult?: ExecResult | ExecError
): MockedExecFn {
  return (command: string, _options: ExecOptions | undefined | null, callback?: MockExecCallback): ChildProcess => {
    if (callback) {
      const result = results.get(command) ?? defaultResult;

      if (!result) {
        // No result configured, return error
        const error = new Error(`No mock result for command: ${command}`) as ExecException;
        callback(error, { stdout: '', stderr: '' });
      } else if ('error' in result) {
        // Error result
        callback(result.error, { stdout: result.stdout, stderr: result.stderr });
      } else {
        // Success result - pass { stdout, stderr } as second arg for promisify compatibility
        callback(null, result);
      }
    }

    return MOCK_CHILD_PROCESS;
  };
}

/**
 * Create a simple mock that returns the same result for all commands.
 *
 * @param result - The result to return for all commands
 * @returns A function suitable for use with vi.mocked(exec).mockImplementation()
 *
 * @example
 * ```typescript
 * vi.mocked(exec).mockImplementation(
 *   createSimpleExecMock(execSuccess('output'))
 * );
 * ```
 */
export function createSimpleExecMock(result: ExecResult | ExecError): MockedExecFn {
  return createExecMock(new Map(), result);
}

/**
 * Create a mock that matches commands by pattern and returns corresponding results.
 *
 * @param patterns - Array of [pattern, result] tuples where pattern is a regex or string
 * @param defaultResult - Optional default result for unmatched commands
 * @returns A function suitable for use with vi.mocked(exec).mockImplementation()
 *
 * @example
 * ```typescript
 * const mockImpl = createPatternExecMock([
 *   [/node/, execSuccess('v20.0.0')],
 *   [/npm/, execSuccess('10.0.0')],
 *   ['exact-cmd', execSuccess('exact match')],
 * ]);
 *
 * vi.mocked(exec).mockImplementation(mockImpl);
 * ```
 */
export function createPatternExecMock(
  patterns: Array<[string | RegExp, ExecResult | ExecError]>,
  defaultResult?: ExecResult | ExecError
): MockedExecFn {
  return (command: string, _options: ExecOptions | undefined | null, callback?: MockExecCallback): ChildProcess => {
    if (callback) {
      let result: ExecResult | ExecError | undefined;

      for (const [pattern, patternResult] of patterns) {
        const matches =
          typeof pattern === 'string' ? command === pattern : pattern.test(command);
        if (matches) {
          result = patternResult;
          break;
        }
      }

      result = result ?? defaultResult;

      if (!result) {
        const error = new Error(`No mock result for command: ${command}`) as ExecException;
        callback(error, { stdout: '', stderr: '' });
      } else if ('error' in result) {
        callback(result.error, { stdout: result.stdout, stderr: result.stderr });
      } else {
        callback(null, result);
      }
    }

    return MOCK_CHILD_PROCESS;
  };
}
