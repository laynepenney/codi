// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EventEmitter } from 'events';

import type { ToolConfirmation, ConfirmationResult } from '../../agent.js';
import type { WorkerState, WorkerResult, ReaderState, ReaderResult } from '../../orchestrate/types.js';
import type { LogMessage } from '../../orchestrate/ipc/protocol.js';
import type { SessionInfo } from '../../session.js';

export type UiMessageKind = 'user' | 'assistant' | 'system' | 'worker';

export interface UiMessage {
  id: string;
  kind: UiMessageKind;
  text: string;
  workerId?: string;
  timestamp: number;
}

export interface UiWorkerLog {
  id: string;
  workerId: string;
  level: LogMessage['level'];
  content: string;
  timestamp: number;
}

export interface UiReaderLog {
  id: string;
  readerId: string;
  level: LogMessage['level'];
  content: string;
  timestamp: number;
}

export interface UiStatus {
  sessionName?: string | null;
  provider?: string;
  model?: string;
  activity?: string | null;
  activityDetail?: string | null;
}

export interface UiConfirmationRequest {
  id: string;
  source: 'agent' | 'worker';
  workerId?: string;
  confirmation: ToolConfirmation;
}

export interface UiSessionSelectionRequest {
  id: string;
  prompt: string;
  sessions: SessionInfo[];
}

interface PendingConfirmation {
  request: UiConfirmationRequest;
  resolve: (result: ConfirmationResult) => void;
}

interface PendingSessionSelection {
  request: UiSessionSelectionRequest;
  resolve: (result: SessionInfo | null) => void;
}

export class InkUiController extends EventEmitter {
  private messageCounter = 0;
  private logCounter = 0;
  private confirmationCounter = 0;
  private confirmations: PendingConfirmation[] = [];
  private sessionSelectionCounter = 0;
  private sessionSelection: PendingSessionSelection | null = null;
  private status: UiStatus = {};
  private statusDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStatus: UiStatus | null = null;
  private chunkBuffer: Map<string, string> = new Map();
  private chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;

  addMessage(kind: UiMessageKind, text: string, workerId?: string): void {
    const message: UiMessage = {
      id: `m${++this.messageCounter}`,
      kind,
      text,
      workerId,
      timestamp: Date.now(),
    };
    this.emit('message', message);
  }

  startAssistantMessage(): string {
    const message: UiMessage = {
      id: `m${++this.messageCounter}`,
      kind: 'assistant',
      text: '',
      timestamp: Date.now(),
    };
    this.emit('message', message);
    return message.id;
  }

  appendToMessage(id: string, chunk: string): void {
    if (!chunk) return;

    // Buffer chunks to reduce re-renders during high-frequency streaming
    const existing = this.chunkBuffer.get(id) ?? '';
    this.chunkBuffer.set(id, existing + chunk);

    if (this.chunkFlushTimer) {
      return; // Already scheduled
    }

    this.chunkFlushTimer = setTimeout(() => {
      this.chunkFlushTimer = null;
      // Flush all buffered chunks
      for (const [msgId, bufferedChunk] of this.chunkBuffer.entries()) {
        if (bufferedChunk) {
          this.emit('messageChunk', { id: msgId, chunk: bufferedChunk });
        }
      }
      this.chunkBuffer.clear();
    }, 16); // ~60fps
  }

  addToolCall(name: string, input: Record<string, unknown>): void {
    const preview = JSON.stringify(input);
    const truncated = preview.length > 100 ? preview.slice(0, 100) + '...' : preview;
    this.addMessage('system', `📎 ${name}\n${truncated}`);
  }

  addToolResult(name: string, result: string, isError: boolean, durationMs: number): void {
    const icon = isError ? '❌' : '✓';
    const durationStr = `${(durationMs / 1000).toFixed(1)}s`;
    if (isError) {
      const preview = result.length > 200 ? `${result.slice(0, 200)}...` : result;
      this.addMessage('system', `${icon} ${name} Error (${durationStr})\n${preview}`);
    } else {
      const lines = result.split('\n').length;
      this.addMessage('system', `${icon} ${name} (${lines} lines, ${durationStr})`);
    }
  }

  addWorkerLog(workerId: string, log: LogMessage): void {
    const entry: UiWorkerLog = {
      id: `l${++this.logCounter}`,
      workerId,
      level: log.level,
      content: log.content,
      timestamp: Date.now(),
    };
    this.emit('workerLog', entry);
  }

  addReaderLog(readerId: string, log: LogMessage): void {
    const entry: UiReaderLog = {
      id: `r${++this.logCounter}`,
      readerId,
      level: log.level,
      content: log.content,
      timestamp: Date.now(),
    };
    this.emit('readerLog', entry);
  }

  updateWorker(state: WorkerState): void {
    this.emit('worker', state);
  }

  updateWorkerResult(result: WorkerResult): void {
    this.emit('workerResult', result);
  }

  updateReader(state: ReaderState): void {
    this.emit('reader', state);
  }

  updateReaderResult(result: ReaderResult): void {
    this.emit('readerResult', result);
  }

  setStatus(status: UiStatus): void {
    // Merge with pending status to coalesce rapid updates
    this.pendingStatus = { ...(this.pendingStatus ?? this.status), ...status };

    // Debounce status updates to prevent excessive re-renders that drop key events
    if (this.statusDebounceTimer) {
      return; // Already scheduled, will pick up pendingStatus
    }

    this.statusDebounceTimer = setTimeout(() => {
      this.statusDebounceTimer = null;
      if (this.pendingStatus) {
        this.status = this.pendingStatus;
        this.pendingStatus = null;
        this.emit('status', this.status);
      }
    }, 16); // ~60fps, allows event loop to process key events between renders
  }

  getStatus(): UiStatus {
    return this.status;
  }

  /**
   * Flush any pending debounced updates immediately.
   * Useful for testing or when immediate updates are needed.
   */
  flush(): void {
    // Flush status updates
    if (this.statusDebounceTimer) {
      clearTimeout(this.statusDebounceTimer);
      this.statusDebounceTimer = null;
    }
    if (this.pendingStatus) {
      this.status = this.pendingStatus;
      this.pendingStatus = null;
      this.emit('status', this.status);
    }

    // Flush chunk buffer
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer);
      this.chunkFlushTimer = null;
    }
    for (const [msgId, bufferedChunk] of this.chunkBuffer.entries()) {
      if (bufferedChunk) {
        this.emit('messageChunk', { id: msgId, chunk: bufferedChunk });
      }
    }
    this.chunkBuffer.clear();
  }

  requestExit(): void {
    this.emit('exit');
  }

  completeAssistantMessage(id: string): void {
    this.emit('messageComplete', id);
  }

  requestConfirmation(
    source: UiConfirmationRequest['source'],
    confirmation: ToolConfirmation,
    workerId?: string
  ): Promise<ConfirmationResult> {
    const request: UiConfirmationRequest = {
      id: `c${++this.confirmationCounter}`,
      source,
      workerId,
      confirmation,
    };

    return new Promise<ConfirmationResult>((resolve) => {
      this.confirmations.push({ request, resolve });
      this.emit('confirmation', this.getActiveConfirmation());
    });
  }

  resolveConfirmation(id: string, result: ConfirmationResult): void {
    const index = this.confirmations.findIndex((item) => item.request.id === id);
    if (index === -1) return;
    const [item] = this.confirmations.splice(index, 1);
    item.resolve(result);
    if (index === 0) {
      this.emit('confirmation', this.getActiveConfirmation());
    }
  }

  getActiveConfirmation(): UiConfirmationRequest | null {
    return this.confirmations[0]?.request ?? null;
  }

  requestSessionSelection(
    sessions: SessionInfo[],
    prompt = 'Select a session to resume:'
  ): Promise<SessionInfo | null> {
    const request: UiSessionSelectionRequest = {
      id: `s${++this.sessionSelectionCounter}`,
      prompt,
      sessions,
    };

    return new Promise<SessionInfo | null>((resolve) => {
      this.sessionSelection = { request, resolve };
      this.emit('sessionSelection', request);
    });
  }

  resolveSessionSelection(id: string, result: SessionInfo | null): void {
    if (!this.sessionSelection || this.sessionSelection.request.id !== id) {
      return;
    }
    const selection = this.sessionSelection;
    this.sessionSelection = null;
    selection.resolve(result);
    this.emit('sessionSelection', null);
  }

  getActiveSessionSelection(): UiSessionSelectionRequest | null {
    return this.sessionSelection?.request ?? null;
  }
}

export interface InkUiControllerEvents {
  message: (message: UiMessage) => void;
  messageChunk: (payload: { id: string; chunk: string }) => void;
  messageComplete: (id: string) => void;
  worker: (state: WorkerState) => void;
  workerLog: (entry: UiWorkerLog) => void;
  workerResult: (result: WorkerResult) => void;
  reader: (state: ReaderState) => void;
  readerLog: (entry: UiReaderLog) => void;
  readerResult: (result: ReaderResult) => void;
  status: (status: UiStatus) => void;
  confirmation: (request: UiConfirmationRequest | null) => void;
  sessionSelection: (request: UiSessionSelectionRequest | null) => void;
  exit: () => void;
}

export interface InkUiController {
  on<K extends keyof InkUiControllerEvents>(event: K, listener: InkUiControllerEvents[K]): this;
  off<K extends keyof InkUiControllerEvents>(event: K, listener: InkUiControllerEvents[K]): this;
}
