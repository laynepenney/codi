# Debug Bridge: Phases 4 & 5 Plan

**Goal:** Add breakpoints, session recording/replay, and time-travel debugging capabilities.

---

## Phase 4: Breakpoints & Session Recording/Replay

### 4.1 Breakpoints

Allow pausing execution when specific conditions are met.

#### Breakpoint Types

| Type | Description | Example |
|------|-------------|---------|
| `tool` | Pause before executing a specific tool | `write_file`, `bash` |
| `iteration` | Pause at a specific iteration count | `5` |
| `pattern` | Pause when input matches a regex | `rm -rf`, `DROP TABLE` |
| `error` | Pause when an error occurs | Any tool error |

#### Commands

```bash
# Add breakpoints
codi-debug breakpoint add tool write_file
codi-debug breakpoint add tool bash --condition "rm -rf"
codi-debug breakpoint add iteration 5
codi-debug breakpoint add pattern "DELETE.*WHERE"
codi-debug breakpoint add error

# List breakpoints
codi-debug breakpoint list

# Remove breakpoints
codi-debug breakpoint remove bp-1234
codi-debug breakpoint clear
```

#### Implementation

```typescript
// src/agent.ts
interface Breakpoint {
  id: string;
  type: 'tool' | 'iteration' | 'pattern' | 'error';
  condition?: string | number | RegExp;
  enabled: boolean;
  hitCount: number;
}

private breakpoints: Map<string, Breakpoint> = new Map();

addBreakpoint(type: Breakpoint['type'], condition?: string | number): string {
  const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  this.breakpoints.set(id, {
    id,
    type,
    condition,
    enabled: true,
    hitCount: 0,
  });
  return id;
}

removeBreakpoint(id: string): boolean {
  return this.breakpoints.delete(id);
}

clearBreakpoints(): void {
  this.breakpoints.clear();
}

private checkBreakpoints(context: BreakpointContext): Breakpoint | null {
  for (const bp of this.breakpoints.values()) {
    if (!bp.enabled) continue;

    switch (bp.type) {
      case 'tool':
        if (context.type === 'tool_call' && context.toolName === bp.condition) {
          bp.hitCount++;
          return bp;
        }
        // Check for pattern in tool input
        if (bp.condition instanceof RegExp && context.toolInput) {
          const inputStr = JSON.stringify(context.toolInput);
          if (bp.condition.test(inputStr)) {
            bp.hitCount++;
            return bp;
          }
        }
        break;

      case 'iteration':
        if (context.iteration === bp.condition) {
          bp.hitCount++;
          return bp;
        }
        break;

      case 'pattern':
        if (context.toolInput) {
          const inputStr = JSON.stringify(context.toolInput);
          const regex = new RegExp(bp.condition as string, 'i');
          if (regex.test(inputStr)) {
            bp.hitCount++;
            return bp;
          }
        }
        break;

      case 'error':
        if (context.type === 'error') {
          bp.hitCount++;
          return bp;
        }
        break;
    }
  }
  return null;
}

// In tool execution path:
const bp = this.checkBreakpoints({
  type: 'tool_call',
  toolName: toolCall.name,
  toolInput: toolCall.input,
  iteration: this.currentIteration,
});

if (bp) {
  this.debugPaused = true;
  getDebugBridge().emit('breakpoint_hit', {
    breakpoint: { id: bp.id, type: bp.type, condition: bp.condition },
    context: { toolName: toolCall.name, iteration: this.currentIteration },
  });
  await this.waitForDebugResume();
}
```

#### New Event Type

```typescript
| 'breakpoint_hit'  // Emitted when a breakpoint is triggered

// Event data
{
  breakpoint: {
    id: string;
    type: 'tool' | 'iteration' | 'pattern' | 'error';
    condition?: string | number;
  };
  context: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    iteration: number;
    error?: string;
  };
}
```

### 4.2 Session Recording

Sessions are already recorded via `events.jsonl`. Enhance with:

#### Full Message Recording

Add complete message snapshots at key points:

```typescript
// New event type for full state capture
| 'checkpoint'

// Emitted periodically or on demand
bridge.emit('checkpoint', {
  iteration: this.currentIteration,
  messages: this.messages,  // Full message array
  summary: this.conversationSummary,
  workingSet: [...this.workingSet],
  tokenCount: this.estimateTokens(),
});
```

#### Automatic Checkpoints

```typescript
// In agent.ts - create checkpoints automatically
private lastCheckpointIteration: number = 0;
private checkpointInterval: number = 5;  // Every 5 iterations

private maybeCreateCheckpoint(): void {
  if (!isDebugBridgeEnabled()) return;

  if (this.currentIteration - this.lastCheckpointIteration >= this.checkpointInterval) {
    this.createCheckpoint();
  }
}

createCheckpoint(label?: string): string {
  const checkpointId = `cp_${this.currentIteration}_${Date.now()}`;

  getDebugBridge().emit('checkpoint', {
    id: checkpointId,
    label,
    iteration: this.currentIteration,
    messages: this.messages,
    summary: this.conversationSummary,
    workingSet: [...this.workingSet],
    tokenCount: countMessageTokens(this.messages),
    timestamp: new Date().toISOString(),
  });

  this.lastCheckpointIteration = this.currentIteration;
  return checkpointId;
}
```

### 4.3 Session Replay

Replay recorded sessions for analysis:

```bash
# Basic replay (prints events)
codi-debug replay <session-id>
codi-debug replay ~/.codi/debug/sessions/debug_20260123_131000_abc1/

# Timed replay (simulates original timing)
codi-debug replay --timed <session-id>

# Speed-adjusted replay
codi-debug replay --speed 2x <session-id>
codi-debug replay --speed 0.5x <session-id>

# Filter specific event types
codi-debug replay --filter tool_call_start,tool_call_end <session-id>

# Jump to specific point
codi-debug replay --from-iteration 10 <session-id>
codi-debug replay --from-sequence 50 <session-id>
```

#### Implementation

```typescript
// src/debug-cli.ts - add replay command

program
  .command('replay <session>')
  .description('Replay a recorded session')
  .option('--timed', 'Replay with original timing')
  .option('--speed <multiplier>', 'Speed multiplier (e.g., 2x, 0.5x)', '1x')
  .option('-f, --filter <types>', 'Filter event types')
  .option('--from-iteration <n>', 'Start from iteration')
  .option('--from-sequence <n>', 'Start from sequence number')
  .action(async (session, opts) => {
    const eventsFile = resolveEventsFile(session);
    const events = readEvents(eventsFile);

    const speed = parseFloat(opts.speed) || 1;
    const filter = opts.filter?.split(',') || [];
    const fromIteration = parseInt(opts.fromIteration) || 0;
    const fromSequence = parseInt(opts.fromSequence) || 0;

    let lastTimestamp: number | null = null;

    for (const event of events) {
      // Skip until we reach starting point
      if (event.sequence < fromSequence) continue;
      if (event.data.iteration && event.data.iteration < fromIteration) continue;

      // Apply filter
      if (filter.length > 0 && !filter.includes(event.type)) continue;

      // Timing
      if (opts.timed && lastTimestamp) {
        const delay = (new Date(event.timestamp).getTime() - lastTimestamp) / speed;
        await sleep(Math.min(delay, 5000));  // Cap at 5 seconds
      }
      lastTimestamp = new Date(event.timestamp).getTime();

      // Display event
      printEvent(event);
    }

    console.log(chalk.dim('\n--- Replay complete ---'));
  });
```

---

## Phase 5: Time Travel Debugging

### Overview

Enable rewinding conversation state to retry prompts with different approaches. This transforms debugging from observation to active experimentation.

### 5.1 Concepts

#### Checkpoints

Named save points in the conversation that capture full state:
- All messages up to that point
- Conversation summary (if any)
- Working set of files
- Tool registry state
- Current iteration

#### Rewind

Restore the agent to a previous checkpoint, discarding all subsequent state.

#### Branch

Fork from a checkpoint to explore an alternative path without losing the original.

#### Timeline

Visual representation of the conversation with checkpoints and branches.

### 5.2 Commands

```bash
# Create a named checkpoint
codi-debug checkpoint create "before refactor"
codi-debug checkpoint create  # Auto-named: cp_iteration_5

# List checkpoints
codi-debug checkpoint list

# Rewind to checkpoint (destructive - loses subsequent state)
codi-debug rewind cp_5_1706012345
codi-debug rewind "before refactor"
codi-debug rewind --iteration 5  # Rewind to auto-checkpoint at iteration 5

# Branch from checkpoint (non-destructive)
codi-debug branch cp_5_1706012345 "alternative approach"
codi-debug branch --from "before refactor" --name "try with typescript"

# Switch between branches
codi-debug switch main
codi-debug switch "alternative approach"

# List branches
codi-debug branch list

# Compare branches
codi-debug diff main "alternative approach"

# View timeline
codi-debug timeline
```

### 5.3 Data Model

```typescript
// Checkpoint structure
interface Checkpoint {
  id: string;                    // cp_<iteration>_<timestamp>
  label?: string;                // User-provided name
  iteration: number;
  timestamp: string;
  messages: Message[];           // Full message history
  summary?: string;              // Conversation summary if exists
  workingSet: string[];          // Open files
  tokenCount: number;
  branch: string;                // Which branch this belongs to
}

// Branch structure
interface Branch {
  name: string;                  // 'main' or user-provided
  parentBranch?: string;         // Branch this was forked from
  forkPoint?: string;            // Checkpoint ID where fork occurred
  created: string;
  checkpoints: string[];         // Checkpoint IDs in this branch
  current: boolean;              // Is this the active branch?
}

// Session timeline
interface Timeline {
  branches: Branch[];
  activeBranch: string;
}
```

### 5.4 Storage

```
~/.codi/debug/sessions/<session-id>/
├── events.jsonl           # Event stream
├── commands.jsonl         # Command stream
├── session.json           # Session metadata
├── timeline.json          # Branch and checkpoint metadata
└── checkpoints/
    ├── cp_5_1706012345.json
    ├── cp_10_1706012400.json
    └── ...
```

#### Checkpoint File Format

```json
{
  "id": "cp_5_1706012345",
  "label": "before refactor",
  "iteration": 5,
  "timestamp": "2026-01-23T12:00:00.000Z",
  "branch": "main",
  "state": {
    "messages": [...],
    "summary": "User asked to refactor the authentication module...",
    "workingSet": ["src/auth.ts", "src/types.ts"],
    "tokenCount": 15000
  }
}
```

### 5.5 Implementation

#### DebugBridge Extensions

```typescript
// src/debug-bridge.ts

// New command types
export type DebugCommandType =
  | 'pause' | 'resume' | 'step' | 'inspect' | 'inject_message'
  | 'breakpoint'
  | 'checkpoint_create'   // Create a checkpoint
  | 'checkpoint_list'     // List checkpoints
  | 'rewind'              // Restore to checkpoint
  | 'branch_create'       // Create a branch from checkpoint
  | 'branch_switch'       // Switch to different branch
  | 'branch_list';        // List branches

// New event types
export type DebugEventType =
  | /* existing */
  | 'checkpoint'          // Checkpoint created
  | 'rewind'              // State rewound to checkpoint
  | 'branch_created'      // New branch created
  | 'branch_switched';    // Switched to different branch
```

#### Agent Extensions

```typescript
// src/agent.ts

class Agent {
  private currentBranch: string = 'main';
  private timeline: Timeline = { branches: [], activeBranch: 'main' };

  // Create checkpoint with full state
  async createCheckpoint(label?: string): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `cp_${this.currentIteration}_${Date.now()}`,
      label,
      iteration: this.currentIteration,
      timestamp: new Date().toISOString(),
      messages: structuredClone(this.messages),
      summary: this.conversationSummary,
      workingSet: [...this.workingSet],
      tokenCount: this.estimateTokens(),
      branch: this.currentBranch,
    };

    await this.saveCheckpoint(checkpoint);

    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit('checkpoint', {
        id: checkpoint.id,
        label: checkpoint.label,
        iteration: checkpoint.iteration,
        branch: checkpoint.branch,
      });
    }

    return checkpoint;
  }

  // Rewind to a checkpoint (destructive)
  async rewind(checkpointId: string): Promise<void> {
    const checkpoint = await this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Restore state
    this.messages = structuredClone(checkpoint.messages);
    this.conversationSummary = checkpoint.summary;
    this.workingSet = new Set(checkpoint.workingSet);
    this.currentIteration = checkpoint.iteration;

    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit('rewind', {
        checkpointId,
        iteration: checkpoint.iteration,
        messageCount: this.messages.length,
      });
    }
  }

  // Branch from checkpoint (non-destructive)
  async createBranch(checkpointId: string, branchName: string): Promise<Branch> {
    const checkpoint = await this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const branch: Branch = {
      name: branchName,
      parentBranch: checkpoint.branch,
      forkPoint: checkpointId,
      created: new Date().toISOString(),
      checkpoints: [],
      current: false,
    };

    this.timeline.branches.push(branch);
    await this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit('branch_created', {
        name: branchName,
        forkPoint: checkpointId,
        parentBranch: checkpoint.branch,
      });
    }

    return branch;
  }

  // Switch to a different branch
  async switchBranch(branchName: string): Promise<void> {
    const branch = this.timeline.branches.find(b => b.name === branchName);
    if (!branch) {
      throw new Error(`Branch not found: ${branchName}`);
    }

    // Find the latest checkpoint in the branch
    const latestCheckpointId = branch.checkpoints[branch.checkpoints.length - 1];
    if (latestCheckpointId) {
      await this.rewind(latestCheckpointId);
    } else if (branch.forkPoint) {
      // New branch with no checkpoints - restore from fork point
      await this.rewind(branch.forkPoint);
    }

    // Update current branch
    this.timeline.branches.forEach(b => b.current = false);
    branch.current = true;
    this.currentBranch = branchName;
    this.timeline.activeBranch = branchName;

    await this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit('branch_switched', {
        branch: branchName,
        iteration: this.currentIteration,
      });
    }
  }

  private async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const checkpointsDir = join(getDebugBridge().getSessionDir(), 'checkpoints');
    mkdirSync(checkpointsDir, { recursive: true });

    const filePath = join(checkpointsDir, `${checkpoint.id}.json`);
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));

    // Add to branch's checkpoint list
    const branch = this.timeline.branches.find(b => b.name === this.currentBranch);
    if (branch) {
      branch.checkpoints.push(checkpoint.id);
      await this.saveTimeline();
    }
  }

  private async loadCheckpoint(id: string): Promise<Checkpoint | null> {
    const filePath = join(getDebugBridge().getSessionDir(), 'checkpoints', `${id}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }

  private async saveTimeline(): Promise<void> {
    const filePath = join(getDebugBridge().getSessionDir(), 'timeline.json');
    writeFileSync(filePath, JSON.stringify(this.timeline, null, 2));
  }
}
```

#### Debug CLI Extensions

```typescript
// src/debug-cli.ts

// Checkpoint commands
program
  .command('checkpoint')
  .description('Manage checkpoints')
  .addCommand(
    new Command('create')
      .description('Create a checkpoint')
      .argument('[label]', 'Optional label for the checkpoint')
      .option('-s, --session <id>', 'Session ID')
      .action((label, opts) => {
        sendCommand('checkpoint_create', { label }, opts.session);
      })
  )
  .addCommand(
    new Command('list')
      .description('List all checkpoints')
      .option('-s, --session <id>', 'Session ID')
      .action((opts) => {
        sendCommand('checkpoint_list', {}, opts.session);
      })
  );

// Rewind command
program
  .command('rewind <checkpoint>')
  .description('Rewind to a checkpoint (destructive)')
  .option('-s, --session <id>', 'Session ID')
  .option('--force', 'Skip confirmation')
  .action((checkpoint, opts) => {
    if (!opts.force) {
      console.log(chalk.yellow('Warning: This will discard all state after the checkpoint.'));
      // In real implementation, prompt for confirmation
    }
    sendCommand('rewind', { checkpointId: checkpoint }, opts.session);
  });

// Branch commands
program
  .command('branch')
  .description('Manage branches')
  .addCommand(
    new Command('create')
      .description('Create a branch from a checkpoint')
      .argument('<name>', 'Branch name')
      .option('--from <checkpoint>', 'Checkpoint to branch from')
      .option('-s, --session <id>', 'Session ID')
      .action((name, opts) => {
        sendCommand('branch_create', {
          name,
          fromCheckpoint: opts.from,
        }, opts.session);
      })
  )
  .addCommand(
    new Command('switch')
      .description('Switch to a branch')
      .argument('<name>', 'Branch name')
      .option('-s, --session <id>', 'Session ID')
      .action((name, opts) => {
        sendCommand('branch_switch', { name }, opts.session);
      })
  )
  .addCommand(
    new Command('list')
      .description('List all branches')
      .option('-s, --session <id>', 'Session ID')
      .action((opts) => {
        sendCommand('branch_list', {}, opts.session);
      })
  );

// Timeline command
program
  .command('timeline')
  .description('Show conversation timeline with checkpoints and branches')
  .option('-s, --session <id>', 'Session ID')
  .action((opts) => {
    const sessionDir = getSessionDir(opts.session);
    const timelineFile = join(sessionDir, 'timeline.json');

    if (!existsSync(timelineFile)) {
      console.log(chalk.dim('No timeline data. Create checkpoints to build timeline.'));
      return;
    }

    const timeline = JSON.parse(readFileSync(timelineFile, 'utf8'));
    printTimeline(timeline);
  });

function printTimeline(timeline: Timeline): void {
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
```

### 5.6 Workflow Example

```
User starts a session:
┌─────────────────────────────────────────────────────────────┐
│  main                                                       │
│  ├── iteration 1: "refactor auth module"                    │
│  ├── iteration 2: tool: read_file(auth.ts)                  │
│  ├── iteration 3: tool: write_file(auth.ts)  ← checkpoint   │
│  ├── iteration 4: "tests are failing"                       │
│  └── iteration 5: tool: bash(npm test) → FAILS              │
└─────────────────────────────────────────────────────────────┘

User wants to try different approach:
$ codi-debug rewind cp_3_xxx
$ codi-debug branch create "try-different-approach" --from cp_3_xxx

┌─────────────────────────────────────────────────────────────┐
│  main (inactive)                                            │
│  ├── iteration 1: "refactor auth module"                    │
│  ├── iteration 2: tool: read_file(auth.ts)                  │
│  └── iteration 3: tool: write_file(auth.ts)  ← fork point   │
│                                              │              │
│  try-different-approach (active)             │              │
│  └── (continuing from fork point)            ◄──────────────┘
└─────────────────────────────────────────────────────────────┘

User retries with different prompt:
> "Actually, let's use a class-based approach instead"

┌─────────────────────────────────────────────────────────────┐
│  main                                                       │
│  ├── 1-3 ...                                                │
│  ├── 4: "tests are failing"                                 │
│  └── 5: FAILS                                               │
│                                                             │
│  try-different-approach (active)                            │
│  ├── 4: "use class-based approach"                          │
│  ├── 5: tool: write_file(auth.ts)                           │
│  └── 6: tool: bash(npm test) → PASSES ✓                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 4 (Breakpoints & Recording)
1. Add breakpoint types and storage to Agent
2. Implement breakpoint checking in tool execution path
3. Add breakpoint commands to debug CLI
4. Add automatic checkpoint creation
5. Implement session replay command
6. Write tests

### Phase 5 (Time Travel)
1. Add checkpoint storage format
2. Implement manual checkpoint creation
3. Implement rewind functionality
4. Implement branch creation and switching
5. Add timeline visualization
6. Add branch comparison
7. Write tests

---

## Tests

### Phase 4 Tests
```typescript
describe('Breakpoints', () => {
  it('should add tool breakpoint');
  it('should add iteration breakpoint');
  it('should add pattern breakpoint');
  it('should pause on tool breakpoint hit');
  it('should pause on iteration breakpoint hit');
  it('should pause on pattern match');
  it('should list breakpoints');
  it('should remove breakpoint');
  it('should clear all breakpoints');
  it('should track hit count');
});

describe('Session Replay', () => {
  it('should replay events in sequence');
  it('should replay with timing');
  it('should replay with speed multiplier');
  it('should filter events during replay');
  it('should start from specific iteration');
});
```

### Phase 5 Tests
```typescript
describe('Checkpoints', () => {
  it('should create checkpoint with full state');
  it('should create checkpoint with label');
  it('should auto-create checkpoints at interval');
  it('should list checkpoints');
  it('should load checkpoint from file');
});

describe('Rewind', () => {
  it('should restore messages from checkpoint');
  it('should restore summary from checkpoint');
  it('should restore working set from checkpoint');
  it('should reset iteration counter');
  it('should emit rewind event');
});

describe('Branches', () => {
  it('should create branch from checkpoint');
  it('should switch between branches');
  it('should maintain separate state per branch');
  it('should list branches');
  it('should track fork point');
});

describe('Timeline', () => {
  it('should build timeline from checkpoints and branches');
  it('should display timeline with branches');
  it('should highlight active branch');
});
```

---

## Dependencies

No new dependencies required. Uses existing:
- `chokidar` - File watching
- `commander` - CLI
- `chalk` - Terminal colors

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large checkpoint files | Compress checkpoint JSON, limit message history |
| Performance on rewind | Lazy load checkpoints, cache recent ones |
| Branch complexity | Limit max branches, auto-cleanup old branches |
| State inconsistency | Validate checkpoint integrity on load |
| Disk space | Auto-prune old checkpoints (keep last N) |
