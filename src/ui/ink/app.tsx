// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput as useInkInput, useStdout } from 'ink';

import type { ConfirmationResult } from '../../agent.js';
import type { ReaderResult, ReaderState, WorkerResult, WorkerState } from '../../orchestrate/types.js';
import { formatSessionInfo } from '../../session.js';
import { completeLine, getCompletionMatches } from '../../completions.js';
import type {
  InkUiController,
  UiConfirmationRequest,
  UiMessage,
  UiReaderLog,
  UiSessionSelectionRequest,
  UiStatus,
  UiWorkerLog,
} from './controller.js';
import { CompletableInput } from './completable-input.js';

type FocusTarget = 'input' | 'activity' | 'selection';

type LogTone = 'label' | 'body' | 'spacer';

interface LogLine {
  text: string;
  kind?: UiMessage['kind'];
  tone?: LogTone;
}

interface ActivityLine {
  text: string;
  color?: string;
  dim?: boolean;
}

interface TreeNode {
  label: string;
  color?: string;
  dim?: boolean;
  children?: TreeNode[];
}

interface StaticBlock {
  id: string;
  lines: LogLine[];
}

export interface InkAppProps {
  controller: InkUiController;
  onSubmit: (input: string) => void | Promise<void>;
  onExit: () => void;
  history?: string[];
}

const MAX_LOG_BUFFER_LINES = 500;
const MAX_HISTORY_ENTRIES = 1000;
const MIN_LIVE_OUTPUT_LINES = 3;
const LIVE_OUTPUT_FRACTION = 0.2;
const MAX_LIVE_OUTPUT_LINES = 10;
const MAX_LIVE_OUTPUT_FRACTION = 0.35;
const SPINNER_FRAMES = ['-', '\\', '|', '/'];
const INACTIVE_STATUSES = new Set(['idle', 'complete', 'failed', 'cancelled']);

const isActiveStatus = (status: string) => !INACTIVE_STATUSES.has(status);

interface ActivityPanelProps {
  workerList: WorkerState[];
  workerLogs: Map<string, string[]>;
  workerResults: Map<string, WorkerResult>;
  selectedWorkerId: string | null;
  showWorkerLogs: boolean;
  showWorkerDetails: boolean;
  readerList: ReaderState[];
  readerLogs: Map<string, string[]>;
  readerResults: Map<string, ReaderResult>;
  status: UiStatus;
  confirmation: UiConfirmationRequest | null;
  contentWidth: number;
  rows: number;
  scrollOffset: number;
}

interface ActivityPanelResult {
  lines: ActivityLine[];
  maxStart: number;
  scrollStep: number;
  total: number;
}

/**
 * Separate component for the activity panel that manages its own spinner state.
 * This isolates spinner animation from the main App component, preventing
 * full app re-renders every 120ms which can drop key events.
 */
function ActivityPanel({
  workerList,
  workerLogs,
  workerResults,
  selectedWorkerId,
  showWorkerLogs,
  showWorkerDetails,
  readerList,
  readerLogs,
  readerResults,
  status,
  confirmation,
  contentWidth,
  rows,
  scrollOffset,
}: ActivityPanelProps) {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  const hasBackgroundProgress = useMemo(() => {
    return workerList.some((worker) => isActiveStatus(worker.status)) ||
      readerList.some((reader) => isActiveStatus(reader.status));
  }, [workerList, readerList]);

  const hasActiveProgress = Boolean(confirmation) ||
    Boolean(status.activity && status.activity !== 'idle') ||
    hasBackgroundProgress;

  useEffect(() => {
    if (!hasActiveProgress) {
      setSpinnerFrame(0);
      return;
    }
    const handle = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(handle);
  }, [hasActiveProgress]);

  const panel = useMemo((): ActivityPanelResult => {
    const hasWorkers = workerList.length > 0;
    const hasReaders = readerList.length > 0;
    const hasConfirmation = Boolean(confirmation);

    const nodes: TreeNode[] = [];
    const detailMax = Math.max(24, contentWidth - 10);
    const activityLabel = formatActivity(status);
    const active = status.activity && status.activity !== 'idle';
    const spinner = hasActiveProgress ? `${SPINNER_FRAMES[spinnerFrame]} ` : '  ';
    const agentColor =
      status.activity === 'confirm' ? 'yellow' : status.activity === 'tool' ? 'magenta' : 'cyan';

    const agentChildren: TreeNode[] = [];
    if (status.activity === 'tool' && status.activityDetail) {
      agentChildren.push({ label: `Tool: ${status.activityDetail}`, dim: true });
    }
    if (status.activity === 'confirm' && status.activityDetail) {
      agentChildren.push({ label: `Confirm: ${status.activityDetail}`, dim: true });
    }

    nodes.push({
      label: `${spinner}Agent: ${activityLabel}`.trimEnd(),
      color: active ? agentColor : 'gray',
      dim: !active,
      children: agentChildren,
    });

    if (hasConfirmation && confirmation) {
      const source =
        confirmation.source === 'worker' ? `Worker ${confirmation.workerId ?? ''}` : 'Agent';
      const confirmChildren: TreeNode[] = [
        { label: `Source: ${source}`, dim: true },
        { label: formatConfirmationTarget(confirmation), dim: true },
      ];
      nodes.push({
        label: `Confirm: ${confirmation.confirmation.toolName}`,
        color: 'yellow',
        children: confirmChildren,
      });
    }

    if (hasWorkers) {
      const workerNodes: TreeNode[] = workerList.map((worker) => {
        const statusLabel = STATUS_LABELS[worker.status] || worker.status.toUpperCase();
        const statusColor = STATUS_COLORS[worker.status] ?? undefined;
        const name = worker.config.branch || worker.config.id;
        const isSelected = worker.config.id === selectedWorkerId;
        const detail = truncate(
          normalizeInline(
            worker.statusMessage ||
              (worker.currentTool ? `tool: ${worker.currentTool}` : '') ||
              (worker.progress !== undefined ? `progress: ${worker.progress}%` : '')
          ),
          detailMax
        );
        const label = detail
          ? `${isSelected ? '> ' : ''}${name} [${statusLabel}] - ${detail}`
          : `${isSelected ? '> ' : ''}${name} [${statusLabel}]`;

        const children: TreeNode[] = [];
        if (isSelected && showWorkerDetails) {
          if (worker.config.task) {
            children.push({ label: `task: ${normalizeInline(worker.config.task)}`, dim: true });
          }
          if (worker.error) {
            children.push({ label: `error: ${worker.error}`, color: 'red' });
          }
          if (showWorkerLogs) {
            const logs = workerLogs.get(worker.config.id) ?? [];
            const lastLog = logs.length > 0 ? normalizeInline(logs[logs.length - 1] ?? '') : '';
            if (lastLog) {
              children.push({ label: `last: ${lastLog}`, dim: true });
            }
          } else {
            const result = workerResults.get(worker.config.id);
            const snippet = result?.response ? firstNonEmptyLine(result.response) : null;
            if (snippet) {
              children.push({ label: `result: ${normalizeInline(snippet)}`, dim: true });
            }
          }
        }

        return {
          label,
          color: statusColor,
          children,
        };
      });

      nodes.push({
        label: `Workers (${workerList.length})`,
        children: workerNodes,
      });
    }

    if (hasReaders) {
      const readerNodes: TreeNode[] = readerList.map((reader) => {
        const statusLabel = STATUS_LABELS[reader.status] || reader.status.toUpperCase();
        const statusColor = STATUS_COLORS[reader.status] ?? undefined;
        const name = `reader:${reader.config.id.slice(-5)}`;
        const logs = readerLogs.get(reader.config.id) ?? [];
        const lastLog = logs.length > 0 ? normalizeInline(logs[logs.length - 1] ?? '') : '';
        const result = readerResults.get(reader.config.id);
        const snippet = result?.response ? firstNonEmptyLine(result.response) : null;
        const errorDetail = reader.error ? `error: ${reader.error}` : '';
        const detail = truncate(
          normalizeInline(
            showWorkerLogs
              ? (errorDetail || lastLog || (reader.currentTool ? `tool: ${reader.currentTool}` : ''))
              : (errorDetail || snippet || lastLog || (reader.currentTool ? `tool: ${reader.currentTool}` : ''))
          ),
          detailMax
        );
        const label = detail
          ? `${name} [${statusLabel}] - ${detail}`
          : `${name} [${statusLabel}]`;

        return {
          label,
          color: statusColor,
        };
      });

      nodes.push({
        label: `Readers (${readerList.length})`,
        children: readerNodes,
      });
    }

    const treeLines = renderTree(nodes, contentWidth);

    // Ensure minimum height to prevent layout jumping
    const minHeight = 3;
    const paddingNeeded = Math.max(0, minHeight - 1 - treeLines.length);
    const padding: ActivityLine[] = Array.from({ length: paddingNeeded }, () => ({ text: '', dim: true }));

    const allLines: ActivityLine[] = [
      { text: 'Activity', dim: true },
      ...treeLines,
      ...padding,
    ];

    const maxHeight = Math.max(minHeight, Math.min(allLines.length, Math.floor(rows / 3)));
    const maxStart = Math.max(0, allLines.length - maxHeight);
    const offset = clamp(scrollOffset, 0, maxStart);
    const start = offset;
    const end = Math.min(allLines.length, start + maxHeight);
    const scrollStep = Math.max(2, Math.floor(maxHeight / 2));

    return {
      lines: allLines.slice(start, end),
      maxStart,
      scrollStep,
      total: allLines.length,
    };
  }, [
    workerList,
    workerLogs,
    workerResults,
    selectedWorkerId,
    showWorkerLogs,
    showWorkerDetails,
    readerList,
    readerLogs,
    readerResults,
    status,
    confirmation,
    hasActiveProgress,
    contentWidth,
    rows,
    scrollOffset,
    spinnerFrame,
  ]);

  if (panel.lines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {panel.lines.map((line, index) => (
        <Text key={`activity-${index}`} color={line.color} dimColor={line.dim}>
          {line.text || ' '}
        </Text>
      ))}
    </Box>
  );
}

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

const STATUS_COLORS: Record<string, string> = {
  starting: 'yellow',
  idle: 'blue',
  thinking: 'cyan',
  tool_call: 'magenta',
  waiting_permission: 'yellow',
  complete: 'green',
  failed: 'red',
  cancelled: 'gray',
};

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

export function InkApp({ controller, onSubmit, onExit, history }: InkAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [staticBlocks, setStaticBlocks] = useState<StaticBlock[]>([]);
  const [workers, setWorkers] = useState<Map<string, WorkerState>>(new Map());
  const [workerLogs, setWorkerLogs] = useState<Map<string, string[]>>(new Map());
  const [workerResults, setWorkerResults] = useState<Map<string, WorkerResult>>(new Map());
  const [readers, setReaders] = useState<Map<string, ReaderState>>(new Map());
  const [readerLogs, setReaderLogs] = useState<Map<string, string[]>>(new Map());
  const [readerResults, setReaderResults] = useState<Map<string, ReaderResult>>(new Map());
  const [status, setStatus] = useState<UiStatus>(() => controller.getStatus());
  const [focus, setFocus] = useState<FocusTarget>('input');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [showWorkerLogs, setShowWorkerLogs] = useState(true);
  const [showWorkerDetails, setShowWorkerDetails] = useState(true);
  const [activityScrollOffset, setActivityScrollOffset] = useState(0);
  const [confirmation, setConfirmation] = useState<UiConfirmationRequest | null>(null);
  const [confirmIndex, setConfirmIndex] = useState(0);
  const [sessionSelection, setSessionSelection] = useState<UiSessionSelectionRequest | null>(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [historyEntries, setHistoryEntries] = useState<string[]>(() => (history ? [...history] : []));
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyBuffer, setHistoryBuffer] = useState('');
  const [completionHint, setCompletionHint] = useState<string | null>(null);
  const [liveAssistant, setLiveAssistant] = useState('');
  const liveAssistantIdRef = useRef<string | null>(null);
  const liveAssistantRef = useRef<string>('');
  const workersRef = useRef<Map<string, WorkerState>>(new Map());
  const staticBlockCounter = useRef(0);

  const contentWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const maxLiveLines = useMemo(() => {
    const rows = stdout.rows ?? 24;
    const target = Math.floor(rows * LIVE_OUTPUT_FRACTION);
    const maxByRows = Math.max(MIN_LIVE_OUTPUT_LINES, Math.floor(rows * MAX_LIVE_OUTPUT_FRACTION));
    const maxLines = Math.min(MAX_LIVE_OUTPUT_LINES, maxByRows);
    return clamp(target, MIN_LIVE_OUTPUT_LINES, maxLines);
  }, [stdout.rows]);

  const appendStaticBlock = (lines: LogLine[]) => {
    if (lines.length === 0) return;
    const nextLines = [...lines];
    if (nextLines[nextLines.length - 1]?.text !== '') {
      nextLines.push({ text: '', tone: 'spacer' });
    }
    const id = `b${++staticBlockCounter.current}`;
    setStaticBlocks((prev) => [...prev, { id, lines: nextLines }]);
  };

  useEffect(() => {
    const onMessage = (message: UiMessage) => {
      const width = Math.max(20, (stdout.columns ?? 80) - 2);
      if (message.kind === 'assistant') {
        if (message.text && message.text.trim()) {
          appendStaticBlock(formatMessageBlock(message, width, workersRef.current));
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
      appendStaticBlock(formatMessageBlock(message, width, workersRef.current));
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
        appendStaticBlock(
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

    const onReader = (state: ReaderState) => {
      setReaders((prev) => {
        const next = new Map(prev);
        next.set(state.config.id, state);
        return next;
      });
    };

    const onReaderLog = (entry: UiReaderLog) => {
      const lines = entry.content.split('\n').filter((line) => line.length > 0);
      if (lines.length === 0) return;
      setReaderLogs((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.readerId) ?? [];
        const combined = existing.concat(lines);
        next.set(entry.readerId, combined.slice(-MAX_LOG_BUFFER_LINES));
        return next;
      });
    };

    const onReaderResult = (result: ReaderResult) => {
      setReaderResults((prev) => {
        const next = new Map(prev);
        next.set(result.readerId, result);
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

    const onSessionSelection = (request: UiSessionSelectionRequest | null) => {
      setSessionSelection(request);
      setSessionIndex(0);
      if (request) {
        setFocus('selection');
      } else {
        setFocus('input');
      }
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
    controller.on('reader', onReader);
    controller.on('readerLog', onReaderLog);
    controller.on('readerResult', onReaderResult);
    controller.on('status', onStatus);
    controller.on('confirmation', onConfirmation);
    controller.on('sessionSelection', onSessionSelection);
    controller.on('exit', onExitRequest);

    const existingStatus = controller.getStatus();
    if (existingStatus) {
      setStatus(existingStatus);
    }
    const existingSelection = controller.getActiveSessionSelection();
    if (existingSelection) {
      setSessionSelection(existingSelection);
      setSessionIndex(0);
      setFocus('selection');
    }

    return () => {
      controller.off('message', onMessage);
      controller.off('messageChunk', onMessageChunk);
      controller.off('messageComplete', onMessageComplete);
      controller.off('worker', onWorker);
      controller.off('workerLog', onWorkerLog);
      controller.off('workerResult', onWorkerResult);
      controller.off('reader', onReader);
      controller.off('readerLog', onReaderLog);
      controller.off('readerResult', onReaderResult);
      controller.off('status', onStatus);
      controller.off('confirmation', onConfirmation);
      controller.off('sessionSelection', onSessionSelection);
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

  const readerList = useMemo(() => {
    return Array.from(readers.values()).sort((a, b) => {
      const aTime = a.startedAt?.getTime?.() ?? 0;
      const bTime = b.startedAt?.getTime?.() ?? 0;
      return aTime - bTime;
    });
  }, [readers]);

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
    setActivityScrollOffset(0);
    setShowWorkerDetails(true);
  }, [selectedWorkerId, showWorkerLogs]);


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

  const handleCompletion = (): string | null => {
    if (!inputValue.startsWith('/')) return null;
    return completeLine(inputValue);
  };

  const handleNextCompletion = (): string | null => {
    // Handle Tab cycling through completions
    if (!inputValue.startsWith('/')) return null;
    const matches = getCompletionMatches(inputValue);
    if (matches.length === 0) return null;
    
    // If we already have matches, find current position and cycle
    const currentMatch = matches.find(m => m.trim() === inputValue.trim());
    
    if (!currentMatch) {
      // Start from first match
      return matches[0]?.trim() ?? null;
    }
    
    // Find next match
    const currentIndex = matches.indexOf(currentMatch);
    const nextIndex = (currentIndex + 1) % matches.length;
    return matches[nextIndex]?.trim() ?? null;
  };

  const handlePrevCompletion = (): string | null => {
    // Handle Shift+Tab to cycle backwards
    if (!inputValue.startsWith('/')) return null;
    const matches = getCompletionMatches(inputValue);
    if (matches.length === 0) return null;
    
    const currentMatch = matches.find(m => m.trim() === inputValue.trim());
    
    if (!currentMatch) {
      // Start from last match
      return matches[matches.length - 1]?.trim() ?? null;
    }
    
    // Find previous match
    const currentIndex = matches.indexOf(currentMatch);
    const prevIndex = (currentIndex - 1 + matches.length) % matches.length;
    return matches[prevIndex]?.trim() ?? null;
  };

  useInkInput((input, key) => {
    const inputKey = input.toLowerCase();
    
    // Handle Ctrl+C
    if (key.ctrl && input === 'c') {
      onExit();
      (useApp().exit)();
      return;
    }

    if (sessionSelection) {
      if (key.upArrow) {
        setSessionIndex((prev) =>
          prev > 0 ? prev - 1 : Math.max(0, sessionSelection.sessions.length - 1)
        );
        return;
      }
      if (key.downArrow) {
        setSessionIndex((prev) =>
          prev < sessionSelection.sessions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (key.return) {
        const selection = sessionSelection.sessions[sessionIndex] ?? null;
        controller.resolveSessionSelection(sessionSelection.id, selection);
        return;
      }
      if (key.escape) {
        controller.resolveSessionSelection(sessionSelection.id, null);
        return;
      }
      if (/^\d$/.test(input)) {
        const num = Number.parseInt(input, 10);
        if (num >= 1 && num <= sessionSelection.sessions.length) {
          controller.resolveSessionSelection(sessionSelection.id, sessionSelection.sessions[num - 1] ?? null);
        }
        return;
      }
      return;
    }

    // Handle Shift+Tab - switch focus (completion cycling handled by CompletableInput)
    if (key.shift && key.tab) {
      // Only switch focus if NOT in input mode, or if input doesn't start with /
      if (focus !== 'input' || (confirmation || sessionSelection || !inputValue.startsWith('/'))) {
        setFocus((prev) => (prev === 'input' ? 'activity' : 'input'));
      }
      return;
    }
    
    // Handle Ctrl+W - switch focus
    if (key.ctrl && inputKey === 'w') {
      setFocus((prev) => (prev === 'input' ? 'activity' : 'input'));
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

    if (focus === 'input') {
      // Arrow keys for history (let CompletableInput handle cursor movement)
      if (key.upArrow) {
        handleHistoryUp();
        return;
      }
      if (key.downArrow) {
        handleHistoryDown();
        return;
      }
    }

    if (focus === 'activity') {
      if (
        key.pageUp ||
        key.pageDown ||
        (key.ctrl && (input.toLowerCase() === 'u' || input.toLowerCase() === 'd'))
      ) {
        const step = activityScrollInfo.scrollStep || 3;
        const maxStart = activityScrollInfo.maxStart;
        if (maxStart > 0) {
          const delta = (key.pageUp || (key.ctrl && input.toLowerCase() === 'u')) ? -step : step;
          setActivityScrollOffset((prev) => clamp(prev + delta, 0, maxStart));
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
      if (key.leftArrow) {
        setShowWorkerDetails(false);
        return;
      }
      if (key.rightArrow) {
        setShowWorkerDetails(true);
        return;
      }
      if (key.return) {
        setShowWorkerDetails((prev) => !prev);
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
    return truncateLiveBlock(block, maxLiveLines);
  }, [liveAssistant, contentWidth, maxLiveLines]);

  const workerCount = workerList.length;
  const readerCount = readerList.length;

  // Simplified scroll info calculation - doesn't depend on spinnerFrame
  // This avoids triggering re-renders every 120ms in the parent component
  const activityScrollInfo = useMemo(() => {
    // Estimate total lines: header + agent + workers + readers + details
    const baseLines = 3; // Activity header, Agent line, padding
    const workerLines = workerList.length * (showWorkerDetails ? 3 : 1);
    const readerLines = readerList.length;
    const confirmLines = confirmation ? 3 : 0;
    const estimatedTotal = baseLines + workerLines + readerLines + confirmLines;

    const rows = stdout.rows ?? 24;
    const maxHeight = Math.max(3, Math.min(estimatedTotal, Math.floor(rows / 3)));
    const maxStart = Math.max(0, estimatedTotal - maxHeight);
    const scrollStep = Math.max(2, Math.floor(maxHeight / 2));

    return { maxStart, scrollStep };
  }, [workerList.length, readerList.length, showWorkerDetails, confirmation, stdout.rows]);

  useEffect(() => {
    setActivityScrollOffset((prev) => clamp(prev, 0, activityScrollInfo.maxStart));
  }, [activityScrollInfo.maxStart]);

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

  const sessionLines = useMemo(() => {
    if (!sessionSelection) return [];
    const lines: string[] = [];
    lines.push(sessionSelection.prompt);
    sessionSelection.sessions.forEach((session, index) => {
      const prefix = index === sessionIndex ? '▶ ' : '  ';
      lines.push(`${prefix}${formatSessionInfo(session)}`);
    });
    lines.push('');
    lines.push('(Use ↑↓ arrow keys to navigate, Enter to select, Esc to cancel)');
    lines.push('(Or type a number 1-9 to jump to that session)');
    return wrapDisplayLines(lines, contentWidth);
  }, [sessionSelection, sessionIndex, contentWidth]);

  const statusLines = useMemo(() => {
    const session = status.sessionName ? status.sessionName : 'none';
    const modelLabel = status.provider && status.model ? `${status.provider}/${status.model}` : 'unknown';

    const infoParts = [
      `Session ${session}`,
      `Model ${modelLabel}`,
      `Workers ${workerCount}`,
      `Readers ${readerCount}`,
    ];
    if (focus === 'activity') {
      infoParts.push('Focus activity');
    }
    const infoLine = infoParts.join(' | ');

    return wrapDisplayLines([infoLine], contentWidth);
  }, [status, focus, contentWidth, workerCount, readerCount]);

  const hintLine = useMemo(() => {
    if (confirmation) {
      return 'Confirm: Up/Down, Enter, y=approve, n=deny, a=abort';
    }
    if (sessionSelection) {
      return 'Session: Up/Down, Enter to select, Esc to cancel';
    }
    if (focus === 'activity') {
      return 'Activity: Up/Down select | Left/Right or Enter expand | PgUp/PgDn scroll | L log/result | Esc back';
    }
    if (completionHint) {
      return completionHint;
    }
    // Normal input mode - show completion hint
    return 'Commands: Tab to complete | Shift+Tab to cycle back | Esc to switch to activity panel';
  }, [confirmation, focus, completionHint]);

  const hintLines = useMemo(() => {
    if (!hintLine) return [];
    return wrapDisplayLines([hintLine], contentWidth);
  }, [hintLine, contentWidth]);

  const handleSubmit = async (submitted?: string) => {
    const trimmed = (submitted ?? inputValue).trim();
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
      <Static items={staticBlocks}>
        {(block) => (
          <Box key={block.id} flexDirection="column">
            {block.lines.map((line, index) => (
              <Text
                key={`${block.id}-${index}`}
                color={line.tone === 'label' && line.kind ? MESSAGE_COLORS[line.kind] : undefined}
                dimColor={line.tone === 'label'}
              >
                {line.text || ' '}
              </Text>
            ))}
          </Box>
        )}
      </Static>
      {liveAssistantLines.length > 0 && (
        <Box flexDirection="column">
          {liveAssistantLines.map((line, index) => (
            <Text
              key={`live-${index}`}
              color={line.tone === 'label' && line.kind ? MESSAGE_COLORS[line.kind] : undefined}
              dimColor={line.tone === 'label'}
            >
              {line.text || ' '}
            </Text>
          ))}
        </Box>
      )}
      {sessionLines.length > 0 && (
        <Box flexDirection="column">
          {sessionLines.map((line, index) => (
            <Text key={`session-${index}`}>
              {line || ' '}
            </Text>
          ))}
        </Box>
      )}
      <ActivityPanel
        workerList={workerList}
        workerLogs={workerLogs}
        workerResults={workerResults}
        selectedWorkerId={selectedWorkerId}
        showWorkerLogs={showWorkerLogs}
        showWorkerDetails={showWorkerDetails}
        readerList={readerList}
        readerLogs={readerLogs}
        readerResults={readerResults}
        status={status}
        confirmation={confirmation}
        contentWidth={contentWidth}
        rows={stdout.rows ?? 24}
        scrollOffset={activityScrollOffset}
      />
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
          <CompletableInput
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
            onTab={(value) => {
              const matches = getCompletionMatches(value);
              if (matches.length === 0) return null;
              
              // Cycle through all matches
              const currentMatch = matches.find(m => m.trim() === value.trim());
              let nextMatch: string;
              
              if (!currentMatch) {
                // Start from first match
                nextMatch = matches[0]?.trim() ?? null;
              } else {
                // Find next match
                const currentIndex = matches.indexOf(currentMatch);
                const nextIndex = (currentIndex + 1) % matches.length;
                nextMatch = matches[nextIndex]?.trim() ?? null;
              }
              
              if (nextMatch !== null && nextMatch !== value) {
                setCompletionHint(matches.length > 1 ? `(${matches.length} matches) ${nextMatch.trim()}` : null);
              }
              
              return nextMatch;
            }}
            focus={focus === 'input' && !confirmation && !sessionSelection}
            placeholder={focus === 'input' && !sessionSelection ? 'Type a command' : ''}
            showCursor={true}
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

function truncateLiveBlock(lines: LogLine[], maxLines: number): LogLine[] {
  if (lines.length <= maxLines) return lines;
  if (maxLines <= 1) return lines.slice(0, 1);
  if (maxLines === 2) return [lines[0], lines[lines.length - 1]];
  const label = lines[0];
  const tailCount = Math.max(1, maxLines - 2);
  const tail = lines.slice(-tailCount);
  const ellipsis: LogLine = { text: '  ...', kind: label.kind, tone: 'body' };
  return [label, ellipsis, ...tail];
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

function normalizeInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
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

function renderTree(nodes: TreeNode[], width: number, prefix = ''): ActivityLine[] {
  const lines: ActivityLine[] = [];
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = isLast ? '`- ' : '|- ';
    const linePrefix = `${prefix}${branch}`;
    const wrapped = wrapWithPrefix(linePrefix, node.label, width);
    for (const line of wrapped) {
      lines.push({ text: line, color: node.color, dim: node.dim });
    }
    if (node.children && node.children.length > 0) {
      const childPrefix = `${prefix}${isLast ? '   ' : '|  '}`;
      lines.push(...renderTree(node.children, width, childPrefix));
    }
  });
  return lines;
}
