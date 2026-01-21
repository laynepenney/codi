// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ConfirmationResult } from '../../agent.js';
import type { WorkerResult, WorkerState } from '../../orchestrate/types.js';
import type {
  InkUiController,
  UiConfirmationRequest,
  UiMessage,
  UiStatus,
  UiWorkerLog,
} from './controller.js';

type FocusTarget = 'input' | 'workers' | 'scroll';

type LogTone = 'label' | 'body' | 'spacer';

interface LogLine {
  text: string;
  kind?: UiMessage['kind'];
  tone?: LogTone;
}

export interface InkAppProps {
  controller: InkUiController;
  onSubmit: (input: string) => void | Promise<void>;
  onExit: () => void;
  history?: string[];
  completer?: (line: string) => [string[], string];
}

const MAX_LOG_BUFFER_LINES = 500;
const MAX_HISTORY_ENTRIES = 1000;

const STATUS_LABELS: Record<string, string> = {
  starting: 'STARTING',
  idle: 'IDLE',
  thinking: 'THINKING',
  waiting_permission: 'PERMISSION',
  tool_call: 'TOOL_CALL',
  complete: 'COMPLETE',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

const SPINNER_FRAMES = ['-', '\\', '|', '/'];

const MESSAGE_LABELS: Record<UiMessage['kind'], string> = {
  user: 'You',
  assistant: 'AI',
  system: 'System',
  worker: 'Worker',
};

const MESSAGE_COLORS = {
  user: 'cyan',
  assistant: 'green',
  system: 'yellow',
  worker: 'magenta',
} as const;

export function InkApp({ controller, onSubmit, onExit, history, completer }: InkAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [workers, setWorkers] = useState<Map<string, WorkerState>>(new Map());
  const [workerLogs, setWorkerLogs] = useState<Map<string, string[]>>(new Map());
  const [workerResults, setWorkerResults] = useState<Map<string, WorkerResult>>(new Map());
  const [status, setStatus] = useState<UiStatus>(() => controller.getStatus());
  const [focus, setFocus] = useState<FocusTarget>('input');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [showWorkerLogs, setShowWorkerLogs] = useState(true);
  const [workerScrollOffset, setWorkerScrollOffset] = useState(0);
  const [logScrollOffset, setLogScrollOffset] = useState(0);
  const [confirmation, setConfirmation] = useState<UiConfirmationRequest | null>(null);
  const [confirmIndex, setConfirmIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [historyEntries, setHistoryEntries] = useState<string[]>(() => (history ? [...history] : []));
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyBuffer, setHistoryBuffer] = useState('');
  const [completionHint, setCompletionHint] = useState<string | null>(null);
  const [liveAssistant, setLiveAssistant] = useState('');
  const liveAssistantIdRef = useRef<string | null>(null);
  const liveAssistantRef = useRef<string>('');
  const workersRef = useRef<Map<string, WorkerState>>(new Map());
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  const contentWidth = Math.max(20, (stdout.columns ?? 80) - 2);

  const appendMessageBlock = (lines: LogLine[]) => {
    if (lines.length === 0) return;
    setLogLines((prev) => {
      const next = [...prev];
      const addSpacer = next.length > 0;
      if (addSpacer) {
        next.push({ text: '', tone: 'spacer' });
      }
      next.push(...lines);
      const added = lines.length + (addSpacer ? 1 : 0);
      if (added > 0) {
        setLogScrollOffset((offset) => (offset > 0 ? offset + added : 0));
      }
      return next;
    });
  };

  useEffect(() => {
    const onMessage = (message: UiMessage) => {
      const width = Math.max(20, (stdout.columns ?? 80) - 2);
      if (message.kind === 'assistant') {
        if (message.text && message.text.trim()) {
          appendMessageBlock(formatMessageBlock(message, width, workersRef.current));
          liveAssistantIdRef.current = null;
          liveAssistantRef.current = '';
          setLiveAssistant('');
        } else {
          liveAssistantIdRef.current = message.id;
          liveAssistantRef.current = '';
          setLiveAssistant('');
        }
        return;
      }
      appendMessageBlock(formatMessageBlock(message, width, workersRef.current));
    };

    const onMessageChunk = ({ id, chunk }: { id: string; chunk: string }) => {
      if (!chunk) return;
      if (liveAssistantIdRef.current !== id) {
        liveAssistantIdRef.current = id;
        liveAssistantRef.current = '';
        setLiveAssistant('');
      }
      const next = `${liveAssistantRef.current}${chunk}`;
      liveAssistantRef.current = next;
      setLiveAssistant(next);
    };

    const onMessageComplete = (id: string) => {
      if (!liveAssistantIdRef.current || liveAssistantIdRef.current !== id) return;
      const text = liveAssistantRef.current;
      if (text.trim()) {
        const width = Math.max(20, (stdout.columns ?? 80) - 2);
        appendMessageBlock(
          formatMessageBlock(
            {
              id,
              kind: 'assistant',
              text,
              timestamp: Date.now(),
            },
            width,
            workersRef.current
          )
        );
      }
      liveAssistantIdRef.current = null;
      liveAssistantRef.current = '';
      setLiveAssistant('');
    };

    const onWorker = (state: WorkerState) => {
      workersRef.current.set(state.config.id, state);
      setWorkers((prev) => {
        const next = new Map(prev);
        next.set(state.config.id, state);
        return next;
      });
      setSelectedWorkerId((prev) => prev ?? state.config.id);
    };

    const onWorkerLog = (entry: UiWorkerLog) => {
      const lines = entry.content.split('\n').filter((line) => line.length > 0);
      if (lines.length === 0) return;
      setWorkerLogs((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.workerId) ?? [];
        const combined = existing.concat(lines);
        next.set(entry.workerId, combined.slice(-MAX_LOG_BUFFER_LINES));
        return next;
      });
    };

    const onWorkerResult = (result: WorkerResult) => {
      setWorkerResults((prev) => {
        const next = new Map(prev);
        next.set(result.workerId, result);
        return next;
      });
    };

    const onStatus = (nextStatus: UiStatus) => {
      setStatus(nextStatus);
    };

    const onConfirmation = (request: UiConfirmationRequest | null) => {
      setConfirmation(request);
      setConfirmIndex(0);
    };

    const onExitRequest = () => {
      onExit();
      exit();
    };

    controller.on('message', onMessage);
    controller.on('messageChunk', onMessageChunk);
    controller.on('messageComplete', onMessageComplete);
    controller.on('worker', onWorker);
    controller.on('workerLog', onWorkerLog);
    controller.on('workerResult', onWorkerResult);
    controller.on('status', onStatus);
    controller.on('confirmation', onConfirmation);
    controller.on('exit', onExitRequest);

    const existingStatus = controller.getStatus();
    if (existingStatus) {
      setStatus(existingStatus);
    }

    return () => {
      controller.off('message', onMessage);
      controller.off('messageChunk', onMessageChunk);
      controller.off('messageComplete', onMessageComplete);
      controller.off('worker', onWorker);
      controller.off('workerLog', onWorkerLog);
      controller.off('workerResult', onWorkerResult);
      controller.off('status', onStatus);
      controller.off('confirmation', onConfirmation);
      controller.off('exit', onExitRequest);
    };
  }, [controller, exit, onExit, stdout]);

  const workerList = useMemo(() => {
    return Array.from(workers.values()).sort((a, b) => {
      const aTime = a.startedAt?.getTime?.() ?? 0;
      const bTime = b.startedAt?.getTime?.() ?? 0;
      return aTime - bTime;
    });
  }, [workers]);

  useEffect(() => {
    if (!selectedWorkerId && workerList.length > 0) {
      setSelectedWorkerId(workerList[0].config.id);
      return;
    }
    if (selectedWorkerId && !workers.has(selectedWorkerId) && workerList.length > 0) {
      setSelectedWorkerId(workerList[0].config.id);
    }
  }, [selectedWorkerId, workerList, workers]);

  useEffect(() => {
    setWorkerScrollOffset(0);
  }, [selectedWorkerId, showWorkerLogs]);

  useEffect(() => {
    const active = status.activity && status.activity !== 'idle';
    if (!active) {
      setSpinnerIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [status.activity]);

  const confirmationOptions = useMemo(() => {
    if (!confirmation) return [];
    const options: Array<{ label: string; result: ConfirmationResult }> = [
      { label: 'Approve', result: 'approve' },
      { label: 'Deny', result: 'deny' },
      { label: 'Abort', result: 'abort' },
    ];
    const suggestions = confirmation.confirmation.approvalSuggestions;
    if (suggestions?.suggestedPattern) {
      options.push({
        label: `Approve pattern: ${suggestions.suggestedPattern}`,
        result: { type: 'approve_pattern', pattern: suggestions.suggestedPattern },
      });
    }
    if (suggestions?.matchedCategories?.length) {
      for (const category of suggestions.matchedCategories) {
        options.push({
          label: `Approve category: ${category.name}`,
          result: { type: 'approve_category', categoryId: category.id },
        });
      }
    }
    return options;
  }, [confirmation]);

  const handleHistoryUp = () => {
    if (historyEntries.length === 0) return;
    const nextIndex = Math.min(historyEntries.length - 1, historyIndex + 1);
    if (nextIndex === historyIndex) return;
    if (historyIndex === -1) {
      setHistoryBuffer(inputValue);
    }
    setHistoryIndex(nextIndex);
    setInputValue(historyEntries[nextIndex]);
    setCompletionHint(null);
  };

  const handleHistoryDown = () => {
    if (historyIndex === -1) return;
    const nextIndex = historyIndex - 1;
    if (nextIndex < 0) {
      setHistoryIndex(-1);
      setInputValue(historyBuffer);
      setCompletionHint(null);
      return;
    }
    setHistoryIndex(nextIndex);
    setInputValue(historyEntries[nextIndex]);
    setCompletionHint(null);
  };

  const handleCompletion = () => {
    if (!completer) return;
    if (!inputValue.startsWith('/')) return;
    const [matches] = completer(inputValue);
    if (matches.length === 0) {
      setCompletionHint('No matches');
      return;
    }
    if (matches.length === 1) {
      setInputValue(matches[0]);
      setCompletionHint(null);
      setHistoryIndex(-1);
      return;
    }
    const prefix = commonPrefix(matches);
    if (prefix.length > inputValue.length) {
      setInputValue(prefix);
      setCompletionHint(null);
      setHistoryIndex(-1);
      return;
    }
    setCompletionHint(`Matches: ${matches.join(', ')}`);
  };

  useInput((input, key) => {
    const inputKey = input.toLowerCase();
    if (key.ctrl && input === 'c') {
      onExit();
      exit();
      return;
    }

    if (key.ctrl && inputKey === 'g') {
      setFocus((prev) => (prev === 'scroll' ? 'input' : 'scroll'));
      return;
    }

    if ((key.shift && key.tab) || (key.ctrl && input.toLowerCase() === 'w')) {
      setFocus((prev) => (prev === 'input' ? 'workers' : 'input'));
      return;
    }

    if (confirmation) {
      if (key.upArrow) {
        setConfirmIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }
      if (key.downArrow) {
        setConfirmIndex((prev) => (prev < confirmationOptions.length - 1 ? prev + 1 : prev));
        return;
      }
      if (key.return) {
        const selected = confirmationOptions[confirmIndex];
        if (selected) {
          controller.resolveConfirmation(confirmation.id, selected.result);
        }
        return;
      }
      if (input.toLowerCase() === 'y') {
        controller.resolveConfirmation(confirmation.id, 'approve');
        return;
      }
      if (input.toLowerCase() === 'n') {
        controller.resolveConfirmation(confirmation.id, 'deny');
        return;
      }
      if (input.toLowerCase() === 'a') {
        controller.resolveConfirmation(confirmation.id, 'abort');
        return;
      }
      return;
    }

    if (focus === 'scroll') {
      const scrollPageUp =
        key.pageUp || (key.ctrl && inputKey === 'u') || (key.ctrl && inputKey === 'b');
      const scrollPageDown =
        key.pageDown || (key.ctrl && inputKey === 'd') || (key.ctrl && inputKey === 'f');
      const scrollLineUp = key.upArrow || (key.ctrl && inputKey === 'k');
      const scrollLineDown = key.downArrow || (key.ctrl && inputKey === 'j');

      if (scrollPageUp || scrollPageDown || scrollLineUp || scrollLineDown) {
        const step = transcriptPanel.scrollStep;
        const maxStart = transcriptPanel.maxStart;
        if (maxStart > 0) {
          let delta = 0;
          if (scrollPageUp) delta = step;
          else if (scrollPageDown) delta = -step;
          else if (scrollLineUp) delta = 1;
          else if (scrollLineDown) delta = -1;
          if (delta !== 0) {
            setLogScrollOffset((prev) => clamp(prev + delta, 0, maxStart));
          }
        }
        return;
      }
      if (key.end) {
        setLogScrollOffset(0);
        return;
      }
      if (key.home) {
        setLogScrollOffset(transcriptPanel.maxStart);
        return;
      }
      if (key.escape || key.return) {
        setFocus('input');
        return;
      }
      return;
    }

    if (focus === 'input') {
      const scrollPageUp =
        key.pageUp ||
        (key.ctrl && inputKey === 'u') ||
        (key.ctrl && inputKey === 'b') ||
        (key.meta && key.upArrow);
      const scrollPageDown =
        key.pageDown ||
        (key.ctrl && inputKey === 'd') ||
        (key.ctrl && inputKey === 'f') ||
        (key.meta && key.downArrow);
      const scrollLineUp = (key.shift && key.upArrow) || (key.ctrl && inputKey === 'k');
      const scrollLineDown = (key.shift && key.downArrow) || (key.ctrl && inputKey === 'j');

      if (scrollPageUp || scrollPageDown || scrollLineUp || scrollLineDown) {
        const step = transcriptPanel.scrollStep;
        const maxStart = transcriptPanel.maxStart;
        if (maxStart > 0) {
          let delta = 0;
          if (scrollPageUp) delta = step;
          else if (scrollPageDown) delta = -step;
          else if (scrollLineUp) delta = 1;
          else if (scrollLineDown) delta = -1;
          if (delta !== 0) {
            setLogScrollOffset((prev) => clamp(prev + delta, 0, maxStart));
          }
        }
        return;
      }
      if (key.end) {
        setLogScrollOffset(0);
        return;
      }
      if (key.home) {
        setLogScrollOffset(transcriptPanel.maxStart);
        return;
      }
      if (key.upArrow) {
        handleHistoryUp();
        return;
      }
      if (key.downArrow) {
        handleHistoryDown();
        return;
      }
      if (key.tab || input === '\t') {
        handleCompletion();
        return;
      }
    }

    if (focus === 'workers') {
      if (
        key.pageUp ||
        key.pageDown ||
        (key.ctrl && (input.toLowerCase() === 'u' || input.toLowerCase() === 'd'))
      ) {
        const step = workerPanel.scrollStep || 3;
        const maxStart = workerPanel.maxStart;
        if (maxStart > 0) {
          const delta = (key.pageUp || (key.ctrl && input.toLowerCase() === 'u')) ? step : -step;
          setWorkerScrollOffset((prev) => {
            const next = showWorkerLogs ? prev + delta : prev - delta;
            return clamp(next, 0, maxStart);
          });
        }
        return;
      }
      if (key.upArrow) {
        if (workerList.length > 0) {
          const index = Math.max(0, workerList.findIndex((w) => w.config.id === selectedWorkerId));
          const next = Math.max(0, index - 1);
          setSelectedWorkerId(workerList[next].config.id);
        }
        return;
      }
      if (key.downArrow) {
        if (workerList.length > 0) {
          const index = Math.max(0, workerList.findIndex((w) => w.config.id === selectedWorkerId));
          const next = Math.min(workerList.length - 1, index + 1);
          setSelectedWorkerId(workerList[next].config.id);
        }
        return;
      }
      if (input.toLowerCase() === 'l') {
        setShowWorkerLogs((prev) => !prev);
        return;
      }
      if (key.escape) {
        setFocus('input');
        return;
      }
    }

    if (key.escape) {
      setFocus('input');
    }
  });

  const selectedWorker = selectedWorkerId ? workers.get(selectedWorkerId) : undefined;
  const liveAssistantLines = useMemo((): LogLine[] => {
    if (!liveAssistant.trim()) return [];
    const block = formatMessageBlock(
      {
        id: liveAssistantIdRef.current ?? 'live',
        kind: 'assistant',
        text: liveAssistant,
        timestamp: Date.now(),
      },
      contentWidth,
      workersRef.current
    );
    const lastLine = logLines[logLines.length - 1];
    if (lastLine && lastLine.text !== '') {
      return [{ text: '', tone: 'spacer' }, ...block];
    }
    return block;
  }, [liveAssistant, contentWidth, logLines]);

  const workerCount = workerList.length;

  const workerPanel = useMemo(() => {
    const lines: string[] = [];
    if (workerList.length === 0) {
      lines.push('Workers: (none)');
      return {
        lines,
        maxStart: 0,
        scrollStep: 0,
      };
    }
    lines.push('Workers');
    for (const worker of workerList) {
      const statusLabel = STATUS_LABELS[worker.status] || worker.status.toUpperCase();
      const name = worker.config.branch || worker.config.id;
      const prefix = worker.config.id === selectedWorkerId ? '>' : ' ';
      const detail =
        worker.statusMessage ||
        (worker.currentTool ? `tool: ${worker.currentTool}` : '') ||
        (worker.progress !== undefined ? `progress: ${worker.progress}%` : '');
      const line = detail
        ? `${prefix} ${name} [${statusLabel}] - ${detail}`
        : `${prefix} ${name} [${statusLabel}]`;
      lines.push(truncate(line, contentWidth));
    }
    lines.push('');

    if (!selectedWorker) {
      lines.push('(select a worker)');
      return {
        lines,
        maxStart: 0,
        scrollStep: 0,
      };
    }
    const name = selectedWorker.config.branch || selectedWorker.config.id;
    const statusLabel = STATUS_LABELS[selectedWorker.status] || selectedWorker.status.toUpperCase();
    lines.push(truncate(`Worker: ${name}`, contentWidth));
    lines.push(truncate(`Status: ${statusLabel}`, contentWidth));
    if (selectedWorker.statusMessage) {
      lines.push(truncate(`Note: ${selectedWorker.statusMessage}`, contentWidth));
    }
    if (selectedWorker.config.task) {
      lines.push(truncate(`Task: ${selectedWorker.config.task}`, contentWidth));
    }
    if (selectedWorker.progress !== undefined) {
      lines.push(truncate(`Progress: ${selectedWorker.progress}%`, contentWidth));
    }
    if (selectedWorker.currentTool) {
      lines.push(truncate(`Tool: ${selectedWorker.currentTool}`, contentWidth));
    }

    const result = workerResults.get(selectedWorker.config.id);
    const logs = workerLogs.get(selectedWorker.config.id) ?? [];

    lines.push('');
    const bodyLines = showWorkerLogs
      ? (logs.length > 0 ? logs : ['(no logs yet)'])
      : (result?.response ? result.response.split('\n') : ['(no result yet)']);
    const wrapped = wrapLines(bodyLines, contentWidth - 4);
    const maxBodyLines = Math.max(6, Math.min(18, Math.floor((stdout.rows ?? 30) / 2)));
    const maxStart = Math.max(0, wrapped.length - maxBodyLines);
    const scrollStep = Math.max(3, Math.floor(maxBodyLines / 2));
    const offset = clamp(workerScrollOffset, 0, maxStart);
    const start = showWorkerLogs ? Math.max(0, maxStart - offset) : offset;
    const end = Math.min(wrapped.length, start + maxBodyLines);
    const rangeLabel = wrapped.length > 0 ? `${start + 1}-${end} of ${wrapped.length}` : '0';
    lines.push(`${showWorkerLogs ? 'Logs' : 'Result'} (${rangeLabel})`);
    const slice = wrapped.slice(start, end);
    for (const line of slice) {
      lines.push(line ? `  ${line}` : '');
    }
    return {
      lines,
      maxStart,
      scrollStep,
    };
  }, [
    workerList,
    selectedWorker,
    selectedWorkerId,
    workerLogs,
    workerResults,
    showWorkerLogs,
    contentWidth,
    stdout.rows,
    workerScrollOffset,
  ]);

  useEffect(() => {
    setWorkerScrollOffset((prev) => clamp(prev, 0, workerPanel.maxStart));
  }, [workerPanel.maxStart]);

  const confirmationLines = useMemo(() => {
    if (!confirmation) return [];
    const lines: string[] = [];
    const target = formatConfirmationTarget(confirmation);
    const danger = confirmation.confirmation.isDangerous ? 'Dangerous' : 'Normal';
    const reason = confirmation.confirmation.dangerReason;
    const summary = confirmation.confirmation.diffPreview?.summary;
    lines.push('Confirm tool');
    lines.push(
      `Source: ${confirmation.source === 'worker' ? `Worker ${confirmation.workerId ?? ''}` : 'Agent'}`
    );
    lines.push(`Tool: ${confirmation.confirmation.toolName}`);
    lines.push(target);
    lines.push(`Risk: ${danger}`);
    if (reason) lines.push(`Reason: ${reason}`);
    if (summary) lines.push(`Diff: ${summary}`);
    lines.push('');
    for (const [index, option] of confirmationOptions.entries()) {
      const prefix = index === confirmIndex ? '>' : ' ';
      lines.push(`${prefix} ${option.label}`);
    }
    return wrapDisplayLines(lines, contentWidth);
  }, [confirmation, confirmationOptions, confirmIndex, contentWidth]);

  const statusLines = useMemo(() => {
    const session = status.sessionName ? status.sessionName : 'none';
    const modelLabel = status.provider && status.model ? `${status.provider}/${status.model}` : 'unknown';
    const activityLabel = formatActivity(status);
    const active = status.activity && status.activity !== 'idle';
    const spinner = active ? `${SPINNER_FRAMES[spinnerIndex]} ` : '';
    const activityLine = `${spinner}${activityLabel}`.trimEnd();

    const infoParts = [`Session ${session}`, `Model ${modelLabel}`, `Workers ${workerCount}`];
    if (focus === 'workers') {
      infoParts.push('Focus workers');
    } else if (focus === 'scroll') {
      infoParts.push('Focus scroll');
    }
    const infoLine = infoParts.join(' | ');
    const combined = `${activityLine} | ${infoLine}`;

    const baseLines = combined.length <= contentWidth ? [combined] : [activityLine, infoLine];
    return wrapDisplayLines(baseLines, contentWidth);
  }, [status, focus, contentWidth, workerCount, spinnerIndex]);

  const estimatedTranscriptCapacity = useMemo(() => {
    const rows = stdout.rows ?? 24;
    const inputHeight = 1;
    const workerHeight = focus === 'workers' ? workerPanel.lines.length : 0;
    const confirmationHeight = confirmationLines.length;
    const reserved = statusLines.length + inputHeight + workerHeight + confirmationHeight;
    return Math.max(1, rows - reserved);
  }, [stdout.rows, statusLines.length, focus, workerPanel.lines.length, confirmationLines.length]);

  const canScrollTranscript = useMemo(() => {
    const totalLines = logLines.length + liveAssistantLines.length;
    return totalLines > estimatedTranscriptCapacity;
  }, [logLines.length, liveAssistantLines.length, estimatedTranscriptCapacity]);

  const hintLine = useMemo(() => {
    if (confirmation) {
      return 'Confirm: Up/Down, Enter, y=approve, n=deny, a=abort';
    }
    if (focus === 'workers') {
      return 'Workers: Up/Down select | PgUp/PgDn or Ctrl+U/Ctrl+D scroll | L logs/result | Esc back';
    }
    if (focus === 'scroll') {
      return 'Scroll mode: Up/Down line | PgUp/PgDn page | Home/End | Esc back';
    }
    if (completionHint) {
      return completionHint;
    }
    if (canScrollTranscript || logScrollOffset > 0) {
      return 'Scroll: Ctrl+G (arrows)';
    }
    return null;
  }, [confirmation, focus, completionHint, canScrollTranscript, logScrollOffset]);

  const hintLines = useMemo(() => {
    if (!hintLine) return [];
    return wrapDisplayLines([hintLine], contentWidth);
  }, [hintLine, contentWidth]);

  const transcriptPanel = useMemo(() => {
    const rows = stdout.rows ?? 24;
    const statusHeight = statusLines.length;
    const hintHeight = hintLines.length;
    const inputHeight = 1;
    const workerHeight = focus === 'workers' ? workerPanel.lines.length : 0;
    const confirmationHeight = confirmationLines.length;
    const reserved = statusHeight + hintHeight + inputHeight + workerHeight + confirmationHeight;
    const available = Math.max(1, rows - reserved);
    const fullLines = logScrollOffset === 0 ? [...logLines, ...liveAssistantLines] : logLines;
    const maxStart = Math.max(0, fullLines.length - available);
    const offset = clamp(logScrollOffset, 0, maxStart);
    const start = Math.max(0, fullLines.length - available - offset);
    const end = Math.min(fullLines.length, start + available);
    const scrollStep = Math.max(3, Math.floor(available / 2));
    return {
      lines: fullLines.slice(start, end),
      maxStart,
      scrollStep,
      start,
      end,
      total: fullLines.length,
    };
  }, [
    stdout.rows,
    statusLines.length,
    hintLines.length,
    focus,
    workerPanel.lines.length,
    confirmationLines.length,
    logLines,
    liveAssistantLines,
    logScrollOffset,
  ]);

  useEffect(() => {
    setLogScrollOffset((prev) => clamp(prev, 0, transcriptPanel.maxStart));
  }, [transcriptPanel.maxStart]);

  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setInputValue('');
    setCompletionHint(null);
    setHistoryIndex(-1);
    setHistoryBuffer('');
    setHistoryEntries((prev) => {
      if (prev[0] === trimmed) return prev;
      const next = [trimmed, ...prev];
      return next.slice(0, MAX_HISTORY_ENTRIES);
    });
    await onSubmit(trimmed);
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {transcriptPanel.lines.map((line, index) => (
          <Text
            key={`log-${index}`}
            color={line.tone === 'label' && line.kind ? MESSAGE_COLORS[line.kind] : undefined}
            dimColor={line.tone === 'label'}
          >
            {line.text || ' '}
          </Text>
        ))}
      </Box>
      {focus === 'workers' && (
        <Box flexDirection="column">
          {workerPanel.lines.map((line, index) => (
            <Text key={`workers-${index}`}>{line}</Text>
          ))}
        </Box>
      )}
      {confirmationLines.length > 0 && (
        <Box flexDirection="column">
          {confirmationLines.map((line, index) => (
            <Text key={`confirm-${index}`}>{line || ' '}</Text>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        {statusLines.map((line, index) => (
          <Text dimColor key={`status-${index}`}>{line || ' '}</Text>
        ))}
        {hintLines.map((line, index) => (
          <Text dimColor key={`hint-${index}`}>{line || ' '}</Text>
        ))}
        <Box>
          <Text color={focus === 'input' && !confirmation ? 'cyan' : 'gray'}>
            {focus === 'input' ? '> ' : '  '}
          </Text>
          <TextInput
            value={inputValue}
            onChange={(value) => {
              setInputValue(value);
              setCompletionHint(null);
              if (historyIndex !== -1) {
                setHistoryIndex(-1);
                setHistoryBuffer(value);
              }
            }}
            onSubmit={handleSubmit}
            isFocused={focus === 'input' && !confirmation}
            placeholder={focus === 'input' ? 'Type a command' : ''}
          />
        </Box>
      </Box>
    </Box>
  );
}

function formatConfirmationTarget(confirmation: UiConfirmationRequest): string {
  const input = confirmation.confirmation.input as Record<string, unknown>;
  const command = typeof input.command === 'string' ? input.command : null;
  if (command) {
    return `Command: ${command}`;
  }
  const filePath = typeof input.file_path === 'string' ? input.file_path : null;
  if (filePath) {
    return `File: ${filePath}`;
  }
  const path = typeof input.path === 'string' ? input.path : null;
  if (path) {
    return `Path: ${path}`;
  }
  return `Input: ${truncate(JSON.stringify(input), 160)}`;
}

function formatMessageBlock(
  message: UiMessage,
  width: number,
  workers: Map<string, WorkerState>
): LogLine[] {
  const label = truncate(getMessageLabel(message, workers), width);
  const lines: LogLine[] = [{ text: label, kind: message.kind, tone: 'label' }];
  const body = message.text ?? '';
  if (!body) {
    return lines;
  }
  const wrapped = wrapText(body, width - 2);
  for (const line of wrapped) {
    if (!line) {
      lines.push({ text: '', kind: message.kind, tone: 'body' });
      continue;
    }
    lines.push({ text: `  ${line}`, kind: message.kind, tone: 'body' });
  }
  return lines;
}

function formatActivity(status: UiStatus): string {
  const activity = status.activity ?? 'idle';
  const detail = status.activityDetail ?? '';

  switch (activity) {
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'tool':
      return detail ? `Tool ${detail}` : 'Tool';
    case 'confirm':
      return detail ? `Confirm ${detail}` : 'Confirm';
    case 'idle':
    default:
      return 'Ready';
  }
}

function getMessageLabel(message: UiMessage, workers: Map<string, WorkerState>): string {
  if (message.kind !== 'worker') {
    return MESSAGE_LABELS[message.kind] ?? 'Message';
  }
  if (!message.workerId) {
    return MESSAGE_LABELS.worker;
  }
  const worker = workers.get(message.workerId);
  const name = worker?.config.branch || message.workerId;
  return `${MESSAGE_LABELS.worker} ${name}`;
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, width));
  }

  return lines;
}

function wrapDisplayLines(lines: string[], width: number): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    if (!line) {
      wrapped.push('');
      continue;
    }
    wrapped.push(...wrapParagraph(line, width));
  }
  return wrapped;
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
        lines.push(...splitLongWord(word, width));
        current = '';
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
      lines.push(...splitLongWord(word, width));
      current = '';
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function splitLongWord(word: string, width: number): string[] {
  if (width <= 0) return [word];
  const lines: string[] = [];
  let remaining = word;
  while (remaining.length > width) {
    lines.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  if (remaining.length > 0) {
    lines.push(remaining);
  }
  return lines;
}

function wrapLines(lines: string[], width: number): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    wrapped.push(...wrapParagraph(line, width));
  }
  return wrapped;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (let i = 1; i < values.length; i += 1) {
    const value = values[i];
    let j = 0;
    while (j < prefix.length && j < value.length && prefix[j] === value[j]) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (!prefix) return '';
  }
  return prefix;
}
