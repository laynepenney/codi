# Debug Bridge: Phases 2 & 3 Plan

**Goal:** Extend the debug bridge to support bidirectional communication, allowing external debuggers to control Codi sessions.

---

## Current State (Phase 1 - Complete in v0.16.0)

The debug bridge streams events to `~/.codi/debug/events.jsonl`:
- Session lifecycle (start, end)
- User input
- Tool calls (start, end, result)
- API requests/responses
- Context compaction
- Errors

**Files:** `src/debug-bridge.ts`, hooks in `src/agent.ts` and `src/index.ts`

### Known Issue: Global Files

Currently all sessions write to the same files:
- `~/.codi/debug/events.jsonl`
- `~/.codi/debug/commands.jsonl`
- `~/.codi/debug/session.json`

This causes conflicts when running multiple Codi instances.

---

## Phase 1.5: Session-Unique Files (Prerequisite Fix)

### Problem

Multiple concurrent Codi sessions overwrite each other's debug files.

### Solution

Use session ID in file paths:

```
~/.codi/debug/
├── sessions/
│   ├── debug_20260123_131000_abc1/
│   │   ├── events.jsonl
│   │   ├── commands.jsonl
│   │   └── session.json
│   ├── debug_20260123_140000_xyz2/
│   │   └── ...
├── current -> sessions/debug_20260123_140000_xyz2  (symlink to latest)
└── index.json  (list of active sessions)
```

### Implementation

```typescript
// src/debug-bridge.ts

// Session-specific directory
private sessionDir: string;

enable(): void {
  this.enabled = true;
  this.sessionDir = join(DEBUG_DIR, 'sessions', this.sessionId);
  this.ensureSessionDir();
  this.updateCurrentSymlink();
  this.registerSession();
  // ...
}

private ensureSessionDir(): void {
  mkdirSync(this.sessionDir, { recursive: true });
}

private updateCurrentSymlink(): void {
  const currentLink = join(DEBUG_DIR, 'current');
  try {
    if (existsSync(currentLink)) unlinkSync(currentLink);
    symlinkSync(this.sessionDir, currentLink);
  } catch {
    // Symlinks may fail on Windows, ignore
  }
}

private registerSession(): void {
  const indexFile = join(DEBUG_DIR, 'index.json');
  const index = existsSync(indexFile)
    ? JSON.parse(readFileSync(indexFile, 'utf8'))
    : { sessions: [] };

  index.sessions.push({
    id: this.sessionId,
    pid: process.pid,
    startTime: new Date().toISOString(),
    cwd: process.cwd(),
  });

  writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

getEventsFile(): string {
  return join(this.sessionDir, 'events.jsonl');
}

getCommandsFile(): string {
  return join(this.sessionDir, 'commands.jsonl');
}
```

### Cleanup

Add session cleanup on shutdown and startup:

```typescript
// On startup: clean up stale sessions (no running process)
private cleanupStaleSessions(): void {
  const indexFile = join(DEBUG_DIR, 'index.json');
  if (!existsSync(indexFile)) return;

  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  index.sessions = index.sessions.filter((s: any) => {
    try {
      process.kill(s.pid, 0);  // Check if process exists
      return true;
    } catch {
      // Process doesn't exist, remove session dir
      rmSync(join(DEBUG_DIR, 'sessions', s.id), { recursive: true, force: true });
      return false;
    }
  });
  writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

// On shutdown: remove from index
shutdown(): void {
  this.unregisterSession();
  // ...
}
```

---

## Phase 2: Command Injection

### Overview

Enable external debuggers to send commands to a running Codi session via `~/.codi/debug/sessions/<session-id>/commands.jsonl`.

### Command Types

| Command | Description | Data |
|---------|-------------|------|
| `pause` | Pause agent loop before next API call | `{}` |
| `resume` | Resume paused agent | `{}` |
| `step` | Execute one iteration then pause | `{}` |
| `inspect` | Request state snapshot | `{ what: 'messages' \| 'context' \| 'tools' \| 'all' }` |
| `inject_message` | Add message to conversation | `{ role: 'user' \| 'assistant', content: string }` |
| `set_variable` | Modify agent state | `{ key: string, value: any }` |
| `cancel_tool` | Cancel pending tool execution | `{ toolId: string }` |

### Implementation

#### 2.1 Command File Watching

Add file watcher to `DebugBridge` class:

```typescript
// src/debug-bridge.ts
import { watch, FSWatcher } from 'chokidar';

private commandWatcher?: FSWatcher;
private commandCallback?: (cmd: DebugCommand) => Promise<void>;
private lastCommandPosition: number = 0;

startCommandWatcher(callback: (cmd: DebugCommand) => Promise<void>): void {
  this.commandCallback = callback;
  this.lastCommandPosition = 0;

  // Use chokidar for reliable cross-platform watching
  this.commandWatcher = watch(this.getCommandsFile(), {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  this.commandWatcher.on('change', () => this.processNewCommands());
}

stopCommandWatcher(): void {
  this.commandWatcher?.close();
  this.commandWatcher = undefined;
}

private async processNewCommands(): Promise<void> {
  const content = readFileSync(this.getCommandsFile(), 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  // Process only new commands since last check
  const newLines = lines.slice(this.lastCommandPosition);
  this.lastCommandPosition = lines.length;

  for (const line of newLines) {
    try {
      const cmd = JSON.parse(line) as DebugCommand;
      await this.commandCallback?.(cmd);
      this.emit('command_executed', { commandId: cmd.id, type: cmd.type });
    } catch (err) {
      this.emit('error', {
        message: `Invalid command: ${err}`,
        context: 'command_processing'
      });
    }
  }
}
```

#### 2.2 Pause/Resume Mechanism

Add pause state to Agent class:

```typescript
// src/agent.ts
private debugPaused: boolean = false;
private debugStepMode: boolean = false;

setDebugPaused(paused: boolean): void {
  this.debugPaused = paused;
  if (isDebugBridgeEnabled()) {
    getDebugBridge().emit(paused ? 'paused' : 'resumed', {});
  }
}

setDebugStep(): void {
  this.debugStepMode = true;
  this.debugPaused = false;  // Resume to execute one step
}

private async waitForDebugResume(): Promise<void> {
  if (!isDebugBridgeEnabled() || !this.debugPaused) return;

  // Emit paused state periodically while waiting
  while (this.debugPaused) {
    getDebugBridge().emit('state_snapshot', {
      paused: true,
      waiting: 'resume',
      iteration: this.currentIteration
    });
    await new Promise(r => setTimeout(r, 500));  // Check every 500ms
  }
}

// In chat() loop, before each API call:
await this.waitForDebugResume();

// After API call, check step mode:
if (this.debugStepMode) {
  this.debugPaused = true;
  this.debugStepMode = false;
  getDebugBridge().emit('step_complete', { iteration: this.currentIteration });
}
```

#### 2.3 State Inspection

Add state snapshot method to Agent:

```typescript
// src/agent.ts
getStateSnapshot(what: 'messages' | 'context' | 'tools' | 'all' = 'all'): StateSnapshot {
  const snapshot: StateSnapshot = {
    timestamp: new Date().toISOString(),
    sessionId: getDebugBridge().getSessionId(),
    iteration: this.currentIteration,
    paused: this.debugPaused,
  };

  if (what === 'messages' || what === 'all') {
    snapshot.messages = {
      count: this.messages.length,
      roles: this.countMessageRoles(),
      recent: this.messages.slice(-3).map(m => ({
        role: m.role,
        preview: getMessageText(m).slice(0, 200),
      })),
    };
  }

  if (what === 'context' || what === 'all') {
    snapshot.context = {
      tokenEstimate: countMessageTokens(this.messages),
      maxTokens: this.maxContextTokens,
      hasSummary: !!this.conversationSummary,
      summaryPreview: this.conversationSummary?.slice(0, 200),
    };
  }

  if (what === 'tools' || what === 'all') {
    snapshot.tools = {
      enabled: this.toolRegistry.getToolNames(),
      count: this.toolRegistry.getToolNames().length,
    };
  }

  snapshot.provider = {
    name: this.provider.getName(),
    model: this.provider.getModel(),
  };

  snapshot.workingSet = [...this.workingSet];

  return snapshot;
}
```

#### 2.4 Command Handler Registration

In `src/index.ts`:

```typescript
if (isDebugBridgeEnabled()) {
  getDebugBridge().startCommandWatcher(async (cmd) => {
    switch (cmd.type) {
      case 'pause':
        agent.setDebugPaused(true);
        break;
      case 'resume':
        agent.setDebugPaused(false);
        break;
      case 'step':
        agent.setDebugStep();
        break;
      case 'inspect':
        const snapshot = agent.getStateSnapshot(cmd.data.what as any);
        getDebugBridge().emit('command_response', {
          commandId: cmd.id,
          type: 'inspect',
          data: snapshot
        });
        break;
      case 'inject_message':
        agent.injectMessage(cmd.data.role as string, cmd.data.content as string);
        getDebugBridge().emit('command_response', {
          commandId: cmd.id,
          type: 'inject_message',
          success: true
        });
        break;
    }
  });
}
```

#### 2.5 New Event Types

```typescript
// Add to DebugEventType
| 'paused'
| 'resumed'
| 'step_complete'
| 'command_response'
| 'breakpoint_hit'
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/debug-bridge.ts` | Session-unique paths, command watcher, new events |
| `src/agent.ts` | Pause/resume/step, state inspection, message injection |
| `src/index.ts` | Register command handler |

---

## Phase 3: Debug CLI & Advanced Features

### Overview

Create a companion CLI tool and add advanced debugging capabilities.

### 3.1 Debug CLI Tool (`codi-debug`)

New binary for interacting with debug sessions:

```bash
# List active sessions
codi-debug sessions

# Watch events in real-time (uses 'current' symlink or specify session)
codi-debug watch
codi-debug watch --session debug_20260123_131000_abc1
codi-debug watch --filter tool_call_start,tool_call_end

# Send commands
codi-debug pause
codi-debug resume
codi-debug step
codi-debug inspect messages
codi-debug inspect all
codi-debug inject user "Please explain this code"

# Interactive mode (combines watch + commands)
codi-debug attach
```

#### Implementation

Create `src/debug-cli.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { appendFileSync, readFileSync, existsSync, readdirSync, lstatSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { watch } from 'chokidar';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';

const DEBUG_DIR = join(homedir(), '.codi', 'debug');

function getSessionDir(sessionId?: string): string {
  if (sessionId) {
    return join(DEBUG_DIR, 'sessions', sessionId);
  }
  // Use 'current' symlink
  const currentLink = join(DEBUG_DIR, 'current');
  if (existsSync(currentLink)) {
    return currentLink;
  }
  throw new Error('No active debug session. Start codi with --debug-bridge');
}

function sendCommand(type: string, data: Record<string, unknown> = {}, sessionId?: string): void {
  const sessionDir = getSessionDir(sessionId);
  const commandsFile = join(sessionDir, 'commands.jsonl');
  const cmd = { type, id: uuid(), data, timestamp: new Date().toISOString() };
  appendFileSync(commandsFile, JSON.stringify(cmd) + '\n');
  console.log(chalk.green(`✓ Sent ${type} command`));
}

const program = new Command();

program
  .name('codi-debug')
  .description('Debug companion for Codi sessions')
  .version('0.16.0');

program
  .command('sessions')
  .description('List active debug sessions')
  .action(() => {
    const indexFile = join(DEBUG_DIR, 'index.json');
    if (!existsSync(indexFile)) {
      console.log('No debug sessions found');
      return;
    }
    const index = JSON.parse(readFileSync(indexFile, 'utf8'));
    console.log(chalk.bold('Active debug sessions:\n'));
    for (const s of index.sessions) {
      console.log(`  ${chalk.cyan(s.id)}`);
      console.log(`    PID: ${s.pid}`);
      console.log(`    Started: ${s.startTime}`);
      console.log(`    CWD: ${s.cwd}\n`);
    }
  });

program
  .command('watch')
  .description('Watch events in real-time')
  .option('-s, --session <id>', 'Session ID (uses current if omitted)')
  .option('-f, --filter <types>', 'Filter event types (comma-separated)')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    const eventsFile = join(sessionDir, 'events.jsonl');
    const filter = opts.filter?.split(',') || [];

    console.log(chalk.dim(`Watching: ${eventsFile}\n`));

    let lastPosition = 0;

    // Initial read
    if (existsSync(eventsFile)) {
      const content = readFileSync(eventsFile, 'utf8');
      lastPosition = content.length;
    }

    // Watch for changes
    const watcher = watch(eventsFile, { persistent: true });
    watcher.on('change', () => {
      const content = readFileSync(eventsFile, 'utf8');
      const newContent = content.slice(lastPosition);
      lastPosition = content.length;

      const lines = newContent.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (filter.length === 0 || filter.includes(event.type)) {
            printEvent(event);
          }
        } catch {}
      }
    });

    console.log(chalk.dim('Press Ctrl+C to stop\n'));
  });

program
  .command('pause')
  .description('Pause the agent')
  .option('-s, --session <id>', 'Session ID')
  .action((opts) => sendCommand('pause', {}, opts.session));

program
  .command('resume')
  .description('Resume the agent')
  .option('-s, --session <id>', 'Session ID')
  .action((opts) => sendCommand('resume', {}, opts.session));

program
  .command('step')
  .description('Execute one iteration then pause')
  .option('-s, --session <id>', 'Session ID')
  .action((opts) => sendCommand('step', {}, opts.session));

program
  .command('inspect [what]')
  .description('Inspect agent state (messages, context, tools, all)')
  .option('-s, --session <id>', 'Session ID')
  .action((what = 'all', opts) => sendCommand('inspect', { what }, opts.session));

program
  .command('inject <role> <content>')
  .description('Inject a message into the conversation')
  .option('-s, --session <id>', 'Session ID')
  .action((role, content, opts) => sendCommand('inject_message', { role, content }, opts.session));

function printEvent(event: any): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const type = event.type.padEnd(20);

  switch (event.type) {
    case 'session_start':
      console.log(chalk.green(`[${time}] ${type}`) + ` ${event.data.provider}/${event.data.model}`);
      break;
    case 'api_request':
      console.log(chalk.blue(`[${time}] ${type}`) + ` ${event.data.messageCount} messages`);
      break;
    case 'api_response':
      console.log(chalk.blue(`[${time}] ${type}`) + ` ${event.data.stopReason} (${event.data.durationMs}ms)`);
      break;
    case 'tool_call_start':
      console.log(chalk.yellow(`[${time}] ${type}`) + ` ${event.data.name}`);
      break;
    case 'tool_call_end':
      const status = event.data.isError ? chalk.red('✗') : chalk.green('✓');
      console.log(chalk.yellow(`[${time}] ${type}`) + ` ${status} ${event.data.name} (${event.data.durationMs}ms)`);
      break;
    case 'paused':
      console.log(chalk.magenta(`[${time}] ${type}`) + ' Agent paused');
      break;
    case 'resumed':
      console.log(chalk.magenta(`[${time}] ${type}`) + ' Agent resumed');
      break;
    case 'error':
      console.log(chalk.red(`[${time}] ${type}`) + ` ${event.data.message}`);
      break;
    default:
      console.log(chalk.dim(`[${time}] ${type}`));
  }
}

program.parse();
```

Add to `package.json`:
```json
{
  "bin": {
    "codi": "./dist/index.js",
    "codi-debug": "./dist/debug-cli.js"
  }
}
```

### 3.2 Breakpoints

Allow setting breakpoints on tool calls or iterations:

```typescript
// Command types
{ type: 'breakpoint', data: { action: 'add', on: 'tool', name: 'write_file' } }
{ type: 'breakpoint', data: { action: 'add', on: 'iteration', count: 5 } }
{ type: 'breakpoint', data: { action: 'add', on: 'pattern', regex: 'rm -rf' } }
{ type: 'breakpoint', data: { action: 'list' } }
{ type: 'breakpoint', data: { action: 'clear', id: 'bp-123' } }
{ type: 'breakpoint', data: { action: 'clear-all' } }

// In agent.ts
interface Breakpoint {
  id: string;
  type: 'tool' | 'iteration' | 'pattern';
  condition: string | number;
}

private breakpoints: Breakpoint[] = [];

addBreakpoint(bp: Omit<Breakpoint, 'id'>): string {
  const id = `bp-${Date.now()}`;
  this.breakpoints.push({ ...bp, id });
  return id;
}

private shouldBreak(context: { type: string; name?: string; input?: any; iteration?: number }): Breakpoint | null {
  for (const bp of this.breakpoints) {
    if (bp.type === 'tool' && context.type === 'tool' && context.name === bp.condition) {
      return bp;
    }
    if (bp.type === 'iteration' && context.iteration === bp.condition) {
      return bp;
    }
    if (bp.type === 'pattern' && context.input) {
      const inputStr = JSON.stringify(context.input);
      if (new RegExp(bp.condition as string).test(inputStr)) {
        return bp;
      }
    }
  }
  return null;
}

// Before tool execution
const bp = this.shouldBreak({ type: 'tool', name: toolCall.name, input: toolCall.input });
if (bp) {
  this.debugPaused = true;
  getDebugBridge().emit('breakpoint_hit', { breakpoint: bp, toolCall });
}
```

### 3.3 Session Recording & Replay

```bash
# Events are already recorded to events.jsonl
# Add replay command to codi-debug

codi-debug replay ~/.codi/debug/sessions/debug_20260123_131000_abc1/events.jsonl

# Replay with timing (simulates original pace)
codi-debug replay --timed events.jsonl

# Replay with speed multiplier
codi-debug replay --speed 2x events.jsonl
```

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/debug-cli.ts` | New file - debug companion CLI |
| `src/debug-bridge.ts` | Session-unique paths, breakpoint events |
| `src/agent.ts` | Breakpoint support |
| `package.json` | Add `codi-debug` binary |

---

## Testing Strategy

### Phase 1.5 Tests (Session Isolation)
```typescript
describe('Debug Bridge - Session Isolation', () => {
  it('should create unique session directory');
  it('should update current symlink');
  it('should register session in index');
  it('should clean up stale sessions');
  it('should unregister on shutdown');
});
```

### Phase 2 Tests
```typescript
describe('Debug Bridge - Commands', () => {
  it('should watch commands file for changes');
  it('should process new commands only');
  it('should handle invalid JSON gracefully');
  it('should emit command_executed event');
});

describe('Agent - Debug Control', () => {
  it('should pause on pause command');
  it('should resume on resume command');
  it('should execute single step on step command');
  it('should return state snapshot on inspect');
  it('should inject message into conversation');
});
```

### Phase 3 Tests
```typescript
describe('Debug CLI', () => {
  it('should list active sessions');
  it('should watch events with filtering');
  it('should send commands to correct session');
});

describe('Breakpoints', () => {
  it('should pause on tool breakpoint');
  it('should pause on iteration breakpoint');
  it('should pause on pattern match');
  it('should list breakpoints');
  it('should clear specific breakpoint');
});
```

---

## Verification

### Phase 1.5
1. Start two `codi --debug-bridge` instances
2. Verify each gets unique session directory
3. Verify `current` symlink points to latest
4. Kill one instance, verify cleanup

### Phase 2
1. Start `codi --debug-bridge`
2. In another terminal: `echo '{"type":"pause","id":"test1","data":{}}' >> ~/.codi/debug/current/commands.jsonl`
3. Verify agent pauses (check events.jsonl for `paused` event)
4. Send resume command, verify agent continues

### Phase 3
1. Run `codi-debug sessions` - verify session listed
2. Run `codi-debug watch` - verify events stream
3. Run `codi-debug pause` / `codi-debug resume` - verify control works
4. Run `codi-debug inspect all` - verify state returned

---

## Implementation Order

1. **Phase 1.5**: Session-unique files (prerequisite)
2. **Phase 2**: Command injection (core debugging)
3. **Phase 3**: Debug CLI & breakpoints (UX polish)

---

## Dependencies

- `chokidar` - Already in project
- `commander` - Already in project
- `chalk` - Already in project
- `uuid` - Already in project
- No new dependencies required
