// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Worker status UI renderer.
 *
 * Keeps a bullet-pointed, single-line view of worker output above the readline prompt.
 */

import { clearScreenDown, cursorTo, moveCursor, type Interface as ReadlineInterface } from 'readline';
import chalk from 'chalk';

import type { ReaderResult, ReaderState, WorkerState } from './types.js';
import type { LogMessage, WorkerStatus } from './ipc/protocol.js';

interface WorkerDisplayState {
  state?: WorkerState;
  lastOutput?: string;
  outputLevel?: LogMessage['level'];
  textBuffer?: string;
}

interface ReaderDisplayState {
  state?: ReaderState;
  lastOutput?: string;
  outputLevel?: LogMessage['level'];
  textBuffer?: string;
  resultSnippet?: string;
}

interface ActivityInfo {
  status: string;
  detail?: string | null;
}

interface ConfirmationInfo {
  source: 'agent' | 'worker';
  workerId?: string;
  toolName: string;
  detail?: string;
}

interface TreeNode {
  label: string;
  color?: (text: string) => string;
  dim?: boolean;
  children?: TreeNode[];
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

const ACTIVITY_COLORS: Record<string, (text: string) => string> = {
  thinking: chalk.cyan,
  responding: chalk.cyan,
  tool: chalk.magenta,
  confirm: chalk.yellow,
  idle: chalk.gray,
};

function normalizeOutput(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function measureTextPosition(text: string, columns: number): { row: number; col: number } {
  const width = Math.max(1, columns);
  let row = 0;
  let col = 0;
  for (const char of text) {
    if (char === '\n') {
      row += 1;
      col = 0;
      continue;
    }
    col += 1;
    if (col >= width) {
      row += 1;
      col = 0;
    }
  }
  return { row, col };
}

function getPromptLayout(
  prompt: string,
  line: string,
  cursor: number,
  columns: number
): { cursorRow: number; cursorCol: number; endRow: number; endCol: number } {
  const plainPrompt = stripAnsi(prompt);
  const plainLine = stripAnsi(line);
  const clampedCursor = Math.max(0, Math.min(cursor, plainLine.length));
  const beforeCursor = plainPrompt + plainLine.slice(0, clampedCursor);
  const beforeEnd = plainPrompt + plainLine;
  const cursorPos = measureTextPosition(beforeCursor, columns);
  const endPos = measureTextPosition(beforeEnd, columns);
  return {
    cursorRow: cursorPos.row,
    cursorCol: cursorPos.col,
    endRow: endPos.row,
    endCol: endPos.col,
  };
}

export class WorkerStatusUI {
  private rl: ReadlineInterface;
  private output: NodeJS.WriteStream;
  private workers = new Map<string, WorkerDisplayState>();
  private readers = new Map<string, ReaderDisplayState>();
  private renderedLines = 0;
  private pendingRender: NodeJS.Timeout | null = null;
  private paused = 0;
  private promptActive = false;
  private enabled: boolean;
  private activity: ActivityInfo | null = null;
  private confirmation: ConfirmationInfo | null = null;

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
    this.readers.clear();
    this.activity = null;
    this.confirmation = null;
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

  updateReaderState(state: ReaderState): void {
    const readerId = state.config.id;
    const existing = this.readers.get(readerId) || {};
    existing.state = state;
    this.readers.set(readerId, existing);
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

  updateReaderLog(readerId: string, log: LogMessage): void {
    const existing = this.readers.get(readerId) || {};

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
    this.readers.set(readerId, existing);
    this.scheduleRender();
  }

  updateReaderResult(result: ReaderResult): void {
    const existing = this.readers.get(result.readerId) || {};
    const snippet = firstNonEmptyLine(result.response);
    if (snippet) {
      existing.resultSnippet = normalizeOutput(snippet);
    }
    this.readers.set(result.readerId, existing);
    this.scheduleRender();
  }

  setAgentActivity(status: string | null, detail?: string | null): void {
    if (!status || status === 'idle') {
      this.activity = null;
    } else {
      this.activity = { status, detail };
    }
    this.scheduleRender();
  }

  setConfirmation(info: ConfirmationInfo | null): void {
    this.confirmation = info;
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
    const columns = Math.max(1, this.output.columns || DEFAULT_COLUMNS);
    const rlState = this.rl as unknown as { line?: string; cursor?: number };
    const line = rlState.line ?? '';
    const cursor = typeof rlState.cursor === 'number' ? rlState.cursor : line.length;
    const layout = getPromptLayout(prompt, line, cursor, columns);
    const totalLinesToClear = this.renderedLines + layout.cursorRow;

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
      this.output.write(prompt);
      this.output.write(line);
      const deltaRows = layout.cursorRow - layout.endRow;
      if (deltaRows !== 0) {
        moveCursor(this.output, 0, deltaRows);
      }
      cursorTo(this.output, layout.cursorCol);
    } else if (totalLinesToClear > 0) {
      moveCursor(this.output, 0, totalLinesToClear);
    }

    this.renderedLines = lines.length;
  }

  private buildLines(): string[] {
    const hasWorkers = this.workers.size > 0;
    const hasReaders = this.readers.size > 0;
    const hasConfirmation = Boolean(this.confirmation);
    const hasActivity = Boolean(this.activity);
    if (!hasWorkers && !hasReaders && !hasConfirmation && !hasActivity) {
      return [];
    }

    const columns = Math.max(20, this.output.columns || DEFAULT_COLUMNS);
    const nodes: TreeNode[] = [];

    const activityStatus = this.activity?.status ?? ((hasWorkers || hasConfirmation) ? 'idle' : null);
    if (activityStatus) {
      const label = `Agent: ${formatActivity(activityStatus)}`;
      const children: TreeNode[] = [];
      const detail = normalizeOutput(this.activity?.detail || '');
      if (detail) {
        const prefix = activityStatus === 'tool' ? 'tool' : activityStatus === 'confirm' ? 'confirm' : 'detail';
        children.push({ label: `${prefix}: ${detail}`, dim: true });
      }
      nodes.push({
        label,
        color: ACTIVITY_COLORS[activityStatus] || undefined,
        dim: activityStatus === 'idle',
        children,
      });
    }

    if (this.confirmation) {
      const source = this.confirmation.source === 'worker'
        ? `Worker ${this.confirmation.workerId ?? ''}`.trim()
        : 'Agent';
      const confirmChildren: TreeNode[] = [
        { label: `source: ${source}`, dim: true },
      ];
      if (this.confirmation.detail) {
        confirmChildren.push({ label: this.confirmation.detail, dim: true });
      }
      nodes.push({
        label: `Confirm: ${this.confirmation.toolName}`,
        color: chalk.yellow,
        children: confirmChildren,
      });
    }

    if (hasWorkers) {
      const entries = Array.from(this.workers.entries()).sort((a, b) => {
        const aTime = a[1].state?.startedAt?.getTime?.() ?? 0;
        const bTime = b[1].state?.startedAt?.getTime?.() ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return a[0].localeCompare(b[0]);
      });

      const workerNodes = entries.map(([workerId, display]) => {
        const state = display.state;
        const branch = state?.config.branch || workerId;
        const status = state?.status || ('unknown' as WorkerStatus);
        const statusLabel = status.toUpperCase();
        const detail = normalizeOutput(
          display.lastOutput ||
            state?.statusMessage ||
            (state?.currentTool ? `tool: ${state.currentTool}` : '') ||
            (state?.progress !== undefined ? `progress: ${state.progress}%` : '')
        );
        const label = detail
          ? `${branch} [${statusLabel}] - ${detail}`
          : `${branch} [${statusLabel}]`;

        const children: TreeNode[] = [];
        if (state?.config.task) {
          children.push({ label: `task: ${normalizeOutput(state.config.task)}`, dim: true });
        }
        if (state?.error) {
          children.push({ label: `error: ${normalizeOutput(state.error)}`, color: chalk.red });
        }
        if (display.lastOutput && display.lastOutput !== detail) {
          children.push({ label: `last: ${normalizeOutput(display.lastOutput)}`, dim: true });
        }

        return {
          label,
          color: STATUS_COLORS[status] || undefined,
          children: children.length > 0 ? children : undefined,
        };
      });

      nodes.push({
        label: `Workers (${this.workers.size})`,
        dim: true,
        children: workerNodes,
      });
    }

    if (hasReaders) {
      const entries = Array.from(this.readers.entries()).sort((a, b) => {
        const aTime = a[1].state?.startedAt?.getTime?.() ?? 0;
        const bTime = b[1].state?.startedAt?.getTime?.() ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return a[0].localeCompare(b[0]);
      });

      const readerNodes = entries.map(([readerId, display]) => {
        const state = display.state;
        const shortId = readerId.slice(-5);
        const status = state?.status || ('unknown' as WorkerStatus);
        const statusLabel = status.toUpperCase();
        const detail = normalizeOutput(
          (state?.error ? `error: ${state.error}` : '') ||
            display.lastOutput ||
            display.resultSnippet ||
            (state?.currentTool ? `tool: ${state.currentTool}` : '') ||
            (state?.progress !== undefined ? `progress: ${state.progress}%` : '')
        );
        const label = detail
          ? `reader:${shortId} [${statusLabel}] - ${detail}`
          : `reader:${shortId} [${statusLabel}]`;

        return {
          label,
          color: STATUS_COLORS[status] || undefined,
        };
      });

      nodes.push({
        label: `Readers (${this.readers.size})`,
        dim: true,
        children: readerNodes,
      });
    }

    const lines = ['Activity'];
    lines.push(...renderTree(nodes, columns));
    return lines;
  }
}

function formatActivity(status: string): string {
  switch (status) {
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'tool':
      return 'Tool';
    case 'confirm':
      return 'Confirm';
    case 'idle':
    default:
      return 'Ready';
  }
}

function wrapParagraph(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      if (word.length <= width) {
        current = word;
      } else {
        lines.push(word.slice(0, width));
        current = word.slice(width);
      }
      continue;
    }

    if (current.length + word.length + 1 <= width) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    if (word.length <= width) {
      current = word;
    } else {
      lines.push(word.slice(0, width));
      current = word.slice(width);
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function wrapWithPrefix(prefix: string, text: string, width: number): string[] {
  const available = Math.max(1, width - prefix.length);
  const wrapped = wrapParagraph(text, available);
  if (wrapped.length === 0) {
    return [prefix.trimEnd()];
  }
  return wrapped.map((line, index) =>
    index === 0 ? `${prefix}${line}` : `${' '.repeat(prefix.length)}${line}`
  );
}

function renderTree(nodes: TreeNode[], width: number, prefix = ''): string[] {
  const lines: string[] = [];
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = isLast ? '`- ' : '|- ';
    const linePrefix = `${prefix}${branch}`;
    const wrapped = wrapWithPrefix(linePrefix, node.label, width);
    for (const line of wrapped) {
      const styled = styleLine(line, node.color, node.dim);
      lines.push(styled);
    }
    if (node.children && node.children.length > 0) {
      const childPrefix = `${prefix}${isLast ? '   ' : '|  '}`;
      lines.push(...renderTree(node.children, width, childPrefix));
    }
  });
  return lines;
}

function styleLine(
  text: string,
  colorFn?: (value: string) => string,
  dim?: boolean
): string {
  let output = text;
  if (colorFn) {
    output = colorFn(output);
  }
  if (dim) {
    output = chalk.dim(output);
  }
  return output;
}
