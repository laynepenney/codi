// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Worker status UI renderer.
 *
 * Keeps a bullet-pointed, single-line view of worker output above the readline prompt.
 */

import { clearScreenDown, cursorTo, moveCursor, type Interface as ReadlineInterface } from 'readline';
import chalk from 'chalk';

import type { WorkerState } from './types.js';
import type { LogMessage, WorkerStatus } from './ipc/protocol.js';

interface WorkerDisplayState {
  state?: WorkerState;
  lastOutput?: string;
  outputLevel?: LogMessage['level'];
  textBuffer?: string;
}

const DEFAULT_COLUMNS = 80;
const RENDER_DEBOUNCE_MS = 50;

const STATUS_COLORS: Record<string, (text: string) => string> = {
  starting: chalk.yellow,
  idle: chalk.blue,
  thinking: chalk.cyan,
  tool_call: chalk.magenta,
  waiting_permission: chalk.yellow,
  complete: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

function normalizeOutput(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncatePlain(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return text.slice(0, max - 3) + '...';
}

function getPromptLineLength(prompt: string): number {
  const plain = stripAnsi(prompt);
  const lastNewline = plain.lastIndexOf('\n');
  return lastNewline === -1 ? plain.length : plain.length - lastNewline - 1;
}

function getPromptLineOffset(prompt: string): number {
  const plain = stripAnsi(prompt);
  return plain.split('\n').length - 1;
}

export class WorkerStatusUI {
  private rl: ReadlineInterface;
  private output: NodeJS.WriteStream;
  private workers = new Map<string, WorkerDisplayState>();
  private renderedLines = 0;
  private pendingRender: NodeJS.Timeout | null = null;
  private paused = 0;
  private promptActive = false;
  private enabled: boolean;

  constructor(rl: ReadlineInterface, output: NodeJS.WriteStream = process.stdout) {
    this.rl = rl;
    this.output = output;
    this.enabled = output.isTTY ?? false;
  }

  pause(): void {
    if (this.paused === 0 && this.promptActive) {
      this.renderLines([]);
    }
    this.paused += 1;
  }

  resume(): void {
    if (this.paused > 0) {
      this.paused -= 1;
    }
    if (this.paused === 0 && this.promptActive) {
      this.render();
    }
  }

  setPromptActive(active: boolean, options?: { preservePrompt?: boolean }): void {
    if (!active && this.promptActive && this.paused === 0) {
      const preservePrompt = options?.preservePrompt ?? true;
      this.renderLines([], preservePrompt);
    }
    this.promptActive = active;
    if (active && this.paused === 0) {
      this.render();
    }
  }

  clear(): void {
    this.workers.clear();
    if (this.promptActive) {
      this.render();
    } else {
      this.renderedLines = 0;
    }
  }

  updateWorkerState(state: WorkerState): void {
    const workerId = state.config.id;
    const existing = this.workers.get(workerId) || {};
    existing.state = state;
    this.workers.set(workerId, existing);
    this.scheduleRender();
  }

  updateWorkerLog(workerId: string, log: LogMessage): void {
    const existing = this.workers.get(workerId) || {};

    if (log.level === 'text') {
      const buffer = (existing.textBuffer || '') + log.content;
      const lines = buffer.replace(/\r/g, '').split('\n');
      existing.textBuffer = lines.pop() || '';
      const latest = lines.length > 0 ? lines[lines.length - 1] : existing.textBuffer;
      const compact = normalizeOutput(latest);
      if (compact) {
        existing.lastOutput = compact;
      }
    } else {
      const compact = normalizeOutput(log.content);
      if (compact) {
        existing.lastOutput = compact;
      }
    }

    existing.outputLevel = log.level;
    this.workers.set(workerId, existing);
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (!this.enabled || this.paused > 0 || !this.promptActive) {
      return;
    }
    if (this.pendingRender) {
      return;
    }
    this.pendingRender = setTimeout(() => {
      this.pendingRender = null;
      this.render();
    }, RENDER_DEBOUNCE_MS);
  }

  private render(): void {
    if (!this.enabled || this.paused > 0 || !this.promptActive) {
      return;
    }

    this.renderLines(this.buildLines());
  }

  private renderLines(lines: string[], renderPrompt = true): void {
    if (!this.enabled) {
      return;
    }

    const prompt = this.rl.getPrompt();
    const promptOffset = getPromptLineOffset(prompt);
    const totalLinesToClear = this.renderedLines + promptOffset;

    cursorTo(this.output, 0);
    if (totalLinesToClear > 0) {
      moveCursor(this.output, 0, -totalLinesToClear);
    }
    clearScreenDown(this.output);

    if (lines.length > 0) {
      this.output.write(lines.join('\n'));
      this.output.write('\n');
    }

    if (renderPrompt) {
      const rlState = this.rl as unknown as { line?: string; cursor?: number };
      const line = rlState.line ?? '';
      const cursor = typeof rlState.cursor === 'number' ? rlState.cursor : line.length;

      this.output.write(prompt);
      this.output.write(line);
      cursorTo(this.output, getPromptLineLength(prompt) + cursor);
    } else if (totalLinesToClear > 0) {
      moveCursor(this.output, 0, totalLinesToClear);
    }

    this.renderedLines = lines.length;
  }

  private buildLines(): string[] {
    if (this.workers.size === 0) {
      return [];
    }

    const columns = Math.max(20, this.output.columns || DEFAULT_COLUMNS);
    const lines: string[] = [];

    for (const [workerId, display] of this.workers) {
      const state = display.state;
      const branch = state?.config.branch || workerId;
      const status = state?.status || ('unknown' as WorkerStatus);
      const statusLabel = status.toUpperCase();
      const colorFn = STATUS_COLORS[status] || ((text: string) => text);
      const statusColored = colorFn(statusLabel);

      const statusSegment = `[${statusLabel}]`;
      const prefixBase = '- ';
      const maxBranch = Math.max(0, columns - prefixBase.length - statusSegment.length - 1);
      const branchTrimmed = maxBranch > 0 ? truncatePlain(branch, maxBranch) : '';
      const branchSegment = branchTrimmed ? `${branchTrimmed} ` : '';

      const prefixPlain = `${prefixBase}${branchSegment}${statusSegment}`;
      const prefixColored = `${prefixBase}${branchSegment}[${statusColored}]`;

      let detail =
        display.lastOutput ||
        state?.statusMessage ||
        (state?.currentTool ? `tool: ${state.currentTool}` : '') ||
        (state?.progress !== undefined ? `progress: ${state.progress}%` : '');

      detail = normalizeOutput(detail);

      if (detail) {
        const available = columns - prefixPlain.length - 1;
        const detailTrimmed = truncatePlain(detail, available);
        lines.push(`${prefixColored} ${detailTrimmed}`);
      } else {
        lines.push(prefixColored);
      }
    }

    return lines;
  }
}
