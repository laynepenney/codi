#!/usr/bin/env node
// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Debug CLI - Companion tool for debugging Codi sessions
 *
 * Commands:
 *   watch [--filter <types>]     Watch events in real-time
 *   sessions                     List debug sessions
 *   pause                        Pause the agent
 *   resume                       Resume the agent
 *   step                         Execute one iteration then pause
 *   inspect [what]               Request state snapshot
 *   inject <role> <content>      Inject a message into conversation
 */

import { Command } from 'commander';
import {
  appendFileSync,
  readFileSync,
  readlinkSync,
  existsSync,
  readdirSync,
  lstatSync,
} from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { watch } from 'chokidar';
import type { DebugEvent, DebugCommand, DebugEventType } from './debug-bridge.js';

// ============================================
// Constants
// ============================================

const DEBUG_DIR = join(homedir(), '.codi', 'debug');
const SESSIONS_DIR = join(DEBUG_DIR, 'sessions');
const CURRENT_LINK = join(DEBUG_DIR, 'current');
const INDEX_FILE = join(DEBUG_DIR, 'index.json');

// ============================================
// Types
// ============================================

interface SessionInfo {
  id: string;
  pid: number;
  startTime: string;
  cwd: string;
  active: boolean;
}

interface SessionIndex {
  sessions: {
    id: string;
    pid: number;
    startTime: string;
    cwd: string;
  }[];
}

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a unique command ID.
 */
function generateId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if a process is running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the session directory for the given session ID or 'current'.
 */
function getSessionDir(sessionId?: string): string | null {
  if (!sessionId || sessionId === 'current') {
    // Use the current symlink
    if (!existsSync(CURRENT_LINK)) {
      return null;
    }
    try {
      // Read the symlink target and resolve relative to DEBUG_DIR
      const linkTarget = readlinkSync(CURRENT_LINK);
      return resolve(DEBUG_DIR, linkTarget);
    } catch {
      return null;
    }
  }

  // Check if it's a full session ID
  const fullPath = join(SESSIONS_DIR, sessionId);
  if (existsSync(fullPath)) {
    return fullPath;
  }

  // Try to match partial session ID
  if (existsSync(SESSIONS_DIR)) {
    const sessions = readdirSync(SESSIONS_DIR);
    const match = sessions.find(s => s.includes(sessionId));
    if (match) {
      return join(SESSIONS_DIR, match);
    }
  }

  return null;
}

/**
 * Get the events file path for a session.
 */
function getEventsFile(sessionDir: string): string {
  return join(sessionDir, 'events.jsonl');
}

/**
 * Get the commands file path for a session.
 */
function getCommandsFile(sessionDir: string): string {
  return join(sessionDir, 'commands.jsonl');
}

/**
 * Send a command to the session.
 */
function sendCommand(sessionDir: string, type: DebugCommand['type'], data: Record<string, unknown> = {}): void {
  const cmd: DebugCommand = {
    type,
    id: generateId(),
    data,
  };

  const commandsFile = getCommandsFile(sessionDir);
  appendFileSync(commandsFile, JSON.stringify(cmd) + '\n');
  console.log(chalk.green(`Sent: ${type}`), chalk.gray(`(${cmd.id})`));
}

/**
 * Format a debug event for display.
 */
function formatEvent(event: DebugEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const seq = chalk.gray(`#${event.sequence}`);

  switch (event.type) {
    case 'session_start':
      return `${seq} ${chalk.green('SESSION START')} ${chalk.cyan(event.data.provider as string)}/${chalk.cyan(event.data.model as string)}`;

    case 'session_end':
      return `${seq} ${chalk.red('SESSION END')} duration=${event.data.duration}ms`;

    case 'user_input':
      return `${seq} ${chalk.blue('USER')} ${truncate(event.data.input as string, 80)}`;

    case 'assistant_text':
      return `${seq} ${chalk.magenta('ASSISTANT')} ${truncate(event.data.text as string, 80)}`;

    case 'tool_call_start':
      return `${seq} ${chalk.yellow('TOOL START')} ${chalk.bold(event.data.name as string)} ${formatInput(event.data.input as Record<string, unknown>)}`;

    case 'tool_call_end':
      const duration = event.data.durationMs as number;
      const status = event.data.isError ? chalk.red('ERROR') : chalk.green('OK');
      return `${seq} ${chalk.yellow('TOOL END')} ${chalk.bold(event.data.name as string)} ${status} ${duration}ms`;

    case 'tool_result':
      const resultStatus = event.data.isError ? chalk.red('ERROR') : chalk.green('RESULT');
      return `${seq} ${chalk.yellow('TOOL')} ${resultStatus} ${truncate(event.data.result as string, 60)}`;

    case 'api_request':
      return `${seq} ${chalk.cyan('API REQ')} ${event.data.provider}/${event.data.model} msgs=${event.data.messageCount}`;

    case 'api_response':
      return `${seq} ${chalk.cyan('API RES')} stop=${event.data.stopReason} in=${event.data.inputTokens} out=${event.data.outputTokens} ${event.data.durationMs}ms`;

    case 'context_compaction':
      return `${seq} ${chalk.magenta('COMPACT')} ${event.data.beforeTokens} -> ${event.data.afterTokens} tokens (${event.data.savingsPercent}% saved)`;

    case 'error':
      return `${seq} ${chalk.red('ERROR')} ${event.data.message}${event.data.context ? ` [${event.data.context}]` : ''}`;

    case 'paused':
      return `${seq} ${chalk.yellow('PAUSED')} iteration=${event.data.iteration}`;

    case 'resumed':
      return `${seq} ${chalk.green('RESUMED')}`;

    case 'step_complete':
      return `${seq} ${chalk.blue('STEP')} iteration=${event.data.iteration}`;

    case 'state_snapshot':
      return `${seq} ${chalk.cyan('STATE')} ${JSON.stringify(event.data)}`;

    case 'command_response':
      return `${seq} ${chalk.green('CMD RESPONSE')} ${event.data.type} ${JSON.stringify(event.data.data || {})}`;

    case 'command_executed':
      return `${seq} ${chalk.green('CMD EXECUTED')} ${event.data.type}`;

    case 'model_switch':
      const from = event.data.from as { provider: string; model: string };
      const to = event.data.to as { provider: string; model: string };
      return `${seq} ${chalk.magenta('MODEL SWITCH')} ${from.provider}/${from.model} -> ${to.provider}/${to.model}`;

    case 'breakpoint_hit': {
      const bp = event.data.breakpoint as { id: string; type: string; condition?: unknown };
      const ctx = event.data.context as { toolName?: string; iteration: number; error?: string };
      const condStr = bp.condition ? ` (${bp.condition})` : '';
      return `${seq} ${chalk.red.bold('BREAKPOINT')} ${bp.type}${condStr} at iteration ${ctx.iteration}${ctx.toolName ? ` tool=${ctx.toolName}` : ''}`;
    }

    case 'checkpoint': {
      const cpLabel = event.data.label ? ` "${event.data.label}"` : '';
      return `${seq} ${chalk.green.bold('CHECKPOINT')} ${event.data.id}${cpLabel} iteration=${event.data.iteration} messages=${event.data.messageCount}`;
    }

    // Phase 5: Time travel events
    case 'rewind':
      return `${seq} ${chalk.yellow.bold('REWIND')} to ${event.data.checkpointId} iteration=${event.data.iteration} messages=${event.data.messageCount}`;

    case 'branch_created':
      return `${seq} ${chalk.cyan.bold('BRANCH CREATED')} "${event.data.name}" from ${event.data.forkPoint} (parent: ${event.data.parentBranch})`;

    case 'branch_switched':
      return `${seq} ${chalk.cyan.bold('BRANCH SWITCHED')} to "${event.data.branch}" at iteration ${event.data.iteration}`;

    default:
      return `${seq} ${chalk.gray(event.type)} ${JSON.stringify(event.data)}`;
  }
}

/**
 * Truncate a string for display.
 */
function truncate(str: string, maxLen: number): string {
  const oneLine = str.replace(/\n/g, '\\n');
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + '...';
}

/**
 * Format tool input for display.
 */
function formatInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      parts.push(`${key}="${truncate(value, 30)}"`);
    } else {
      parts.push(`${key}=${JSON.stringify(value)}`);
    }
  }
  return chalk.gray(parts.join(' '));
}

/**
 * Load session index.
 */
function loadSessionIndex(): SessionIndex {
  if (!existsSync(INDEX_FILE)) {
    return { sessions: [] };
  }
  try {
    return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return { sessions: [] };
  }
}

// ============================================
// Commands
// ============================================

const program = new Command();

program
  .name('codi-debug')
  .description('Debug companion for Codi sessions')
  .version('0.16.0');

// Watch command
program
  .command('watch')
  .description('Watch events in real-time')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .option('-f, --filter <types>', 'Filter event types (comma-separated)')
  .option('-n, --tail <lines>', 'Show last N events first', '10')
  .option('--no-color', 'Disable colored output')
  .action(async (opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found. Start codi with --debug-bridge flag.'));
      process.exit(1);
    }

    const eventsFile = getEventsFile(sessionDir);
    if (!existsSync(eventsFile)) {
      console.error(chalk.red(`Events file not found: ${eventsFile}`));
      process.exit(1);
    }

    const filterTypes = opts.filter?.split(',').map((t: string) => t.trim()) as DebugEventType[] | undefined;
    const tailLines = parseInt(opts.tail, 10) || 10;

    console.log(chalk.cyan(`Watching: ${eventsFile}`));
    if (filterTypes) {
      console.log(chalk.gray(`Filter: ${filterTypes.join(', ')}`));
    }
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    // Read existing events and show tail
    let lastPosition = 0;
    try {
      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      lastPosition = lines.length;

      // Show last N events
      const tailEvents = lines.slice(-tailLines);
      for (const line of tailEvents) {
        try {
          const event = JSON.parse(line) as DebugEvent;
          if (!filterTypes || filterTypes.includes(event.type)) {
            console.log(formatEvent(event));
          }
        } catch {
          // Skip invalid lines
        }
      }

      if (tailEvents.length > 0) {
        console.log(chalk.gray('--- watching for new events ---\n'));
      }
    } catch {
      // File empty or doesn't exist yet
    }

    // Watch for new events
    const watcher = watch(eventsFile, {
      persistent: true,
      usePolling: true,
      interval: 100,
    });

    watcher.on('change', () => {
      try {
        const content = readFileSync(eventsFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        const newLines = lines.slice(lastPosition);
        lastPosition = lines.length;

        for (const line of newLines) {
          try {
            const event = JSON.parse(line) as DebugEvent;
            if (!filterTypes || filterTypes.includes(event.type)) {
              console.log(formatEvent(event));
            }
          } catch {
            // Skip invalid lines
          }
        }
      } catch {
        // Ignore read errors
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      watcher.close();
      console.log(chalk.gray('\nStopped watching.'));
      process.exit(0);
    });
  });

// Sessions command
program
  .command('sessions')
  .alias('ls')
  .description('List debug sessions')
  .option('-a, --all', 'Show all sessions (including inactive)')
  .action((opts) => {
    const index = loadSessionIndex();

    if (index.sessions.length === 0) {
      console.log(chalk.gray('No debug sessions found.'));
      return;
    }

    console.log(chalk.bold('Debug Sessions:\n'));

    for (const session of index.sessions) {
      const active = isProcessRunning(session.pid);

      if (!opts.all && !active) continue;

      const status = active ? chalk.green('ACTIVE') : chalk.gray('INACTIVE');
      const time = new Date(session.startTime).toLocaleString();

      console.log(`  ${chalk.cyan(session.id)}`);
      console.log(`    Status: ${status} (PID ${session.pid})`);
      console.log(`    Started: ${time}`);
      console.log(`    CWD: ${chalk.gray(session.cwd)}`);
      console.log();
    }
  });

// Pause command
program
  .command('pause')
  .description('Pause the agent')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'pause');
  });

// Resume command
program
  .command('resume')
  .description('Resume the agent')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'resume');
  });

// Step command
program
  .command('step')
  .description('Execute one iteration then pause')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'step');
  });

// Inspect command
program
  .command('inspect [what]')
  .description('Request state snapshot (messages, context, tools, or all)')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((what, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }

    const validWhat = ['messages', 'context', 'tools', 'all'];
    const inspectWhat = validWhat.includes(what) ? what : 'all';

    sendCommand(sessionDir, 'inspect', { what: inspectWhat });
    console.log(chalk.gray('Watch events to see the response.'));
  });

// Inject command
program
  .command('inject <role> <content>')
  .description('Inject a message into the conversation')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((role, content, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }

    if (!['user', 'assistant'].includes(role)) {
      console.error(chalk.red('Role must be "user" or "assistant"'));
      process.exit(1);
    }

    sendCommand(sessionDir, 'inject_message', { role, content });
  });

// Status command (quick check on current session)
program
  .command('status')
  .description('Show status of current session')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.log(chalk.yellow('No active session.'));
      console.log(chalk.gray('Start codi with --debug-bridge to enable debugging.'));
      return;
    }

    // Read session info
    const sessionFile = join(sessionDir, 'session.json');
    if (!existsSync(sessionFile)) {
      console.log(chalk.yellow('Session info not found.'));
      return;
    }

    try {
      const info = JSON.parse(readFileSync(sessionFile, 'utf8'));
      const active = isProcessRunning(info.pid);

      console.log(chalk.bold('Session Status:\n'));
      console.log(`  ID: ${chalk.cyan(info.sessionId)}`);
      console.log(`  Status: ${active ? chalk.green('ACTIVE') : chalk.gray('INACTIVE')}`);
      console.log(`  PID: ${info.pid}`);
      console.log(`  Started: ${new Date(info.startTime).toLocaleString()}`);
      console.log(`  CWD: ${chalk.gray(info.cwd)}`);
      console.log();
      console.log(`  Events: ${info.eventsFile}`);
      console.log(`  Commands: ${info.commandsFile}`);

      // Count events
      const eventsFile = getEventsFile(sessionDir);
      if (existsSync(eventsFile)) {
        const content = readFileSync(eventsFile, 'utf8');
        const eventCount = content.split('\n').filter(l => l.trim()).length;
        console.log(`  Event count: ${eventCount}`);
      }
    } catch (err) {
      console.error(chalk.red('Failed to read session info:'), err);
    }
  });

// ============================================
// Phase 4: Breakpoints
// ============================================

// Breakpoint command group
const breakpointCmd = new Command('breakpoint')
  .alias('bp')
  .description('Manage breakpoints');

breakpointCmd
  .command('add <type> [condition]')
  .description('Add a breakpoint (types: tool, iteration, pattern, error)')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((type, condition, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }

    const validTypes = ['tool', 'iteration', 'pattern', 'error'];
    if (!validTypes.includes(type)) {
      console.error(chalk.red(`Invalid breakpoint type. Valid types: ${validTypes.join(', ')}`));
      process.exit(1);
    }

    // Parse condition based on type
    let parsedCondition: string | number | undefined = condition;
    if (type === 'iteration' && condition) {
      parsedCondition = parseInt(condition, 10);
      if (isNaN(parsedCondition)) {
        console.error(chalk.red('Iteration condition must be a number'));
        process.exit(1);
      }
    }

    sendCommand(sessionDir, 'breakpoint_add', { type, condition: parsedCondition });
  });

breakpointCmd
  .command('list')
  .alias('ls')
  .description('List all breakpoints')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'breakpoint_list', {});
    console.log(chalk.gray('Watch events to see the response.'));
  });

breakpointCmd
  .command('remove <id>')
  .alias('rm')
  .description('Remove a breakpoint by ID')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((id, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'breakpoint_remove', { id });
  });

breakpointCmd
  .command('clear')
  .description('Clear all breakpoints')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'breakpoint_clear', {});
  });

program.addCommand(breakpointCmd);

// ============================================
// Phase 4: Checkpoints
// ============================================

// Checkpoint command group
const checkpointCmd = new Command('checkpoint')
  .alias('cp')
  .description('Manage checkpoints');

checkpointCmd
  .command('create [label]')
  .description('Create a checkpoint with optional label')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((label, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'checkpoint_create', { label });
  });

checkpointCmd
  .command('list')
  .alias('ls')
  .description('List all checkpoints')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'checkpoint_list', {});
    console.log(chalk.gray('Watch events to see the response.'));
  });

program.addCommand(checkpointCmd);

// ============================================
// Phase 4: Session Replay
// ============================================

program
  .command('replay [session]')
  .description('Replay a recorded session')
  .option('--timed', 'Replay with original timing')
  .option('--speed <multiplier>', 'Speed multiplier (e.g., 2, 0.5)', '1')
  .option('-f, --filter <types>', 'Filter event types (comma-separated)')
  .option('--from-iteration <n>', 'Start from iteration')
  .option('--from-sequence <n>', 'Start from sequence number')
  .action(async (session, opts) => {
    const sessionDir = getSessionDir(session);
    if (!sessionDir) {
      console.error(chalk.red('No session found. Specify a session ID or run from a directory with a current session.'));
      process.exit(1);
    }

    const eventsFile = getEventsFile(sessionDir);
    if (!existsSync(eventsFile)) {
      console.error(chalk.red(`Events file not found: ${eventsFile}`));
      process.exit(1);
    }

    const speed = parseFloat(opts.speed) || 1;
    const filterTypes = opts.filter?.split(',').map((t: string) => t.trim()) as DebugEventType[] | undefined;
    const fromIteration = opts.fromIteration ? parseInt(opts.fromIteration, 10) : 0;
    const fromSequence = opts.fromSequence ? parseInt(opts.fromSequence, 10) : 0;

    console.log(chalk.cyan(`Replaying: ${sessionDir}`));
    if (opts.timed) console.log(chalk.gray(`Speed: ${speed}x`));
    if (filterTypes) console.log(chalk.gray(`Filter: ${filterTypes.join(', ')}`));
    if (fromIteration > 0) console.log(chalk.gray(`Starting from iteration: ${fromIteration}`));
    if (fromSequence > 0) console.log(chalk.gray(`Starting from sequence: ${fromSequence}`));
    console.log();

    // Read all events
    const content = readFileSync(eventsFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const events: DebugEvent[] = [];

    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as DebugEvent);
      } catch {
        // Skip invalid lines
      }
    }

    if (events.length === 0) {
      console.log(chalk.yellow('No events found in session.'));
      return;
    }

    let lastTimestamp: number | null = null;
    let eventsShown = 0;

    for (const event of events) {
      // Skip until we reach starting point
      if (event.sequence < fromSequence) continue;

      // Check iteration filter (data.iteration may not exist on all events)
      const eventIteration = (event.data as { iteration?: number }).iteration;
      if (fromIteration > 0 && eventIteration !== undefined && eventIteration < fromIteration) continue;

      // Apply type filter
      if (filterTypes && !filterTypes.includes(event.type)) continue;

      // Timing
      if (opts.timed && lastTimestamp !== null) {
        const eventTime = new Date(event.timestamp).getTime();
        const delay = (eventTime - lastTimestamp) / speed;
        const actualDelay = Math.min(Math.max(delay, 0), 5000); // Cap at 5 seconds, min 0
        if (actualDelay > 10) {
          await sleep(actualDelay);
        }
      }
      lastTimestamp = new Date(event.timestamp).getTime();

      // Display event
      console.log(formatEvent(event));
      eventsShown++;
    }

    console.log(chalk.gray(`\n--- Replay complete (${eventsShown} events) ---`));
  });

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Phase 5: Time Travel
// ============================================

// Rewind command
program
  .command('rewind <checkpoint>')
  .description('Rewind to a checkpoint (destructive - loses subsequent state)')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((checkpoint, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    console.log(chalk.yellow('Warning: This will discard all state after the checkpoint.'));
    sendCommand(sessionDir, 'rewind', { checkpointId: checkpoint });
  });

// Branch command group
const branchCmd = new Command('branch')
  .alias('br')
  .description('Manage branches for time-travel debugging');

branchCmd
  .command('create <name>')
  .description('Create a branch from a checkpoint')
  .option('--from <checkpoint>', 'Checkpoint to branch from (default: latest)')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((name, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'branch_create', {
      name,
      checkpointId: opts.from,
    });
  });

branchCmd
  .command('switch <name>')
  .description('Switch to a branch')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((name, opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'branch_switch', { name });
  });

branchCmd
  .command('list')
  .alias('ls')
  .description('List all branches')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }
    sendCommand(sessionDir, 'branch_list', {});
    console.log(chalk.gray('Watch events to see the response.'));
  });

program.addCommand(branchCmd);

// Timeline command
program
  .command('timeline')
  .description('Show conversation timeline with checkpoints and branches')
  .option('-s, --session <id>', 'Session ID (default: current)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    if (!sessionDir) {
      console.error(chalk.red('No active session found.'));
      process.exit(1);
    }

    const timelineFile = join(sessionDir, 'timeline.json');

    if (!existsSync(timelineFile)) {
      console.log(chalk.dim('No timeline data. Create checkpoints to build timeline.'));
      return;
    }

    try {
      const timeline = JSON.parse(readFileSync(timelineFile, 'utf8'));
      printTimeline(timeline);
    } catch (err) {
      console.error(chalk.red('Failed to read timeline:'), err);
    }
  });

/**
 * Print timeline visualization.
 */
function printTimeline(timeline: { branches: Array<{ name: string; current: boolean; forkPoint?: string; checkpoints: string[] }> }): void {
  console.log(chalk.bold('\nConversation Timeline\n'));

  for (const branch of timeline.branches) {
    const marker = branch.current ? chalk.green('●') : chalk.dim('○');
    const name = branch.current ? chalk.green.bold(branch.name) : branch.name;

    console.log(`${marker} ${name}`);

    if (branch.forkPoint) {
      console.log(chalk.dim(`  └── forked from ${branch.forkPoint}`));
    }

    for (const cpId of branch.checkpoints) {
      console.log(chalk.cyan(`  ├── ${cpId}`));
    }
    console.log();
  }
}

// Parse and execute
program.parse();
