// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWriteStream, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

import type { InkUiController, UiMessage, UiStatus } from './controller.js';
import type { WorkerState } from '../../orchestrate/types.js';

export interface InkTranscriptOptions {
  controller: InkUiController;
  filePath?: string;
  status?: UiStatus;
  projectName?: string;
  projectPath?: string;
}

export interface InkTranscriptWriter {
  path: string;
  dispose: () => void;
}

const MESSAGE_LABELS: Record<UiMessage['kind'], string> = {
  user: 'You',
  assistant: 'AI',
  system: 'System',
  worker: 'Worker',
};

export function attachInkTranscriptWriter(options: InkTranscriptOptions): InkTranscriptWriter {
  const filePath = options.filePath ?? createTranscriptPath();
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const stream = createWriteStream(filePath, { flags: 'a' });
  const workerNames = new Map<string, string>();
  const assistantBuffers = new Map<string, string>();

  const headerLines = buildHeader(options.status, options.projectName, options.projectPath);
  if (headerLines.length > 0) {
    stream.write(headerLines.join('\n') + '\n\n');
  }

  const writeBlock = (label: string, text: string) => {
    stream.write(`${label}\n`);
    const normalized = normalizeNewlines(text);
    const lines = normalized.length > 0 ? normalized.split('\n') : [];
    if (lines.length === 0) {
      stream.write('\n');
      return;
    }
    for (const line of lines) {
      stream.write(`  ${line}\n`);
    }
    stream.write('\n');
  };

  const handleWorker = (state: WorkerState) => {
    const name = state.config.branch || state.config.id;
    workerNames.set(state.config.id, name);
  };

  const handleMessage = (message: UiMessage) => {
    if (message.kind === 'assistant') {
      if (message.text && message.text.trim()) {
        writeBlock(getLabel(message, workerNames), message.text);
      } else {
        assistantBuffers.set(message.id, '');
      }
      return;
    }
    writeBlock(getLabel(message, workerNames), message.text ?? '');
  };

  const handleChunk = ({ id, chunk }: { id: string; chunk: string }) => {
    if (!chunk) return;
    const existing = assistantBuffers.get(id);
    if (existing === undefined) {
      assistantBuffers.set(id, chunk);
    } else {
      assistantBuffers.set(id, existing + chunk);
    }
  };

  const handleComplete = (id: string) => {
    if (!assistantBuffers.has(id)) return;
    const text = assistantBuffers.get(id) ?? '';
    if (text.trim()) {
      writeBlock(MESSAGE_LABELS.assistant, text);
    }
    assistantBuffers.delete(id);
  };

  const dispose = () => {
    stream.end();
  };

  options.controller.on('worker', handleWorker);
  options.controller.on('message', handleMessage);
  options.controller.on('messageChunk', handleChunk);
  options.controller.on('messageComplete', handleComplete);
  options.controller.on('exit', dispose);

  return { path: filePath, dispose };
}

function buildHeader(status: UiStatus | undefined, projectName?: string, projectPath?: string): string[] {
  const now = new Date();
  const header = ['# Codi transcript', `# Started: ${now.toISOString()}`];
  const sessionName = status?.sessionName ?? 'none';
  header.push(`# Session: ${sessionName}`);
  const modelLabel = status?.provider && status?.model ? `${status.provider}/${status.model}` : 'unknown';
  header.push(`# Model: ${modelLabel}`);
  if (projectName) {
    header.push(`# Project: ${projectName}`);
  }
  if (projectPath) {
    header.push(`# Path: ${projectPath}`);
  }
  return header;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getLabel(message: UiMessage, workers: Map<string, string>): string {
  if (message.kind !== 'worker') {
    return MESSAGE_LABELS[message.kind] ?? 'Message';
  }
  if (!message.workerId) {
    return MESSAGE_LABELS.worker;
  }
  const name = workers.get(message.workerId) ?? message.workerId;
  return `${MESSAGE_LABELS.worker} ${name}`;
}

function createTranscriptPath(): string {
  const transcriptDir = join(homedir(), '.codi', 'transcripts');
  const sessionId = generateSessionId();
  return join(transcriptDir, `${sessionId}.txt`);
}

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}_${time}_${rand}`;
}
