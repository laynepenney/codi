import type { IPty } from 'node-pty';
import * as pty from 'node-pty';

export type PtyChunk = {
  source: 'stdout' | 'stderr';
  data: string;
};

export type WaitForOptions = {
  /** Max time to wait for the pattern to appear in the PTY output. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Minimal PTY harness for running the `codi` CLI in a real TTY.
 *
 * Why: some features (prompts, spinners, readline behavior) only work when the
 * process is attached to a TTY. This helper lets tests interact with `codi`
 * as if it were run by a user.
 */
export class PtyHarness {
  private ptyProcess: IPty;
  private buffer = '';
  private closed: Promise<{ exitCode: number | null; signal?: number | null }>;
  private closedResolve!: (v: { exitCode: number | null; signal?: number | null }) => void;

  constructor(command: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.closed = new Promise((resolve) => {
      this.closedResolve = resolve;
    });

    // NOTE: node-pty merges stdout/stderr into a single data stream.
    // We still tag it as stdout to keep the interface extensible.
    this.ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: opts?.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...opts?.env,
        // Make output deterministic-ish in tests.
        TERM: 'xterm-256color',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    this.ptyProcess.onData((data) => {
      this.buffer += data;
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.closedResolve({ exitCode, signal });
    });
  }

  /** Write raw text to the PTY (no newline added). */
  write(data: string): void {
    this.ptyProcess.write(data);
  }

  /** Write a line (appends `\n`). */
  line(data: string): void {
    this.write(`${data}\n`);
  }

  /** Send Ctrl+C. */
  ctrlC(): void {
    // ETX
    this.write('\x03');
  }

  /** Get the entire captured output so far. */
  output(): string {
    return this.buffer;
  }

  /**
   * Wait until the provided pattern appears in output.
   * Returns the full output buffer at the moment it matched.
   */
  async waitFor(pattern: string | RegExp, options?: WaitForOptions): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const re = typeof pattern === 'string' ? new RegExp(escapeRegExp(pattern)) : pattern;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (re.test(this.buffer)) return this.buffer;
      await new Promise((r) => setTimeout(r, 25));
    }

    throw new Error(
      `Timed out waiting for pattern: ${String(pattern)}\n\nCaptured output:\n${this.buffer}`
    );
  }

  /** Kill the PTY process. */
  kill(signal?: number | string): void {
    this.ptyProcess.kill(signal);
  }

  /** Wait for the PTY process to exit. */
  async waitForExit(): Promise<{ exitCode: number | null; signal?: number | null }> {
    return this.closed;
  }
}
