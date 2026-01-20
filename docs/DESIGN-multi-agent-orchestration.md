# Multi-Agent Orchestration Design Document

## Overview

This document describes the architecture for running multiple Codi agents in parallel using git worktrees, with permission requests bubbling up to a commander agent via IPC.

## Problem Statement

### The Issue We Encountered

When attempting to parallelize feature development using background Claude agents:

1. Created git worktrees: `codi-phase1` and `codi-phase2`
2. Spawned 2 background Task agents to work on separate features
3. **Agent 1** (non-interactive mode) succeeded - created PR #65
4. **Agent 2** (custom commands) got **stuck** with error:
   ```
   Permission to use Write has been auto-denied (prompts unavailable)
   ```

### Root Cause Analysis

The `onConfirm` callback in `src/agent.ts` requires the readline interface to prompt users:

```typescript
// In index.ts, the onConfirm callback uses readline
onConfirm: async (confirmation) => {
  // This requires readline which isn't available in background agents
  const result = await promptConfirmationWithSuggestions(rl, confirmation);
  return result;
}
```

When no readline is available (background processes), the callback either:
- Returns `undefined` → auto-denies
- Throws an error → agent fails

### Why This Matters

Parallel agent workflows are powerful for:
- Implementing multiple features simultaneously
- Running different models on different tasks
- Scaling development throughput
- CI/CD automation with human oversight

Without permission bubbling, agents either:
1. Get stuck waiting for permissions they can't receive
2. Auto-deny everything, limiting their capabilities
3. Require `--auto-approve` which removes safety guardrails

## Solution Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    Commander (Parent Process)                    │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Orchestrator  │  │ Permission   │  │ Readline Interface   │ │
│  │ Manager       │  │ Handler      │  │ (User Interaction)   │ │
│  └───────┬───────┘  └──────┬───────┘  └──────────────────────┘ │
│          │                 │                                     │
│  ┌───────┴─────────────────┴───────────┐                        │
│  │       Unix Domain Socket Server      │                        │
│  │       (~/.codi/orchestrator.sock)    │                        │
│  └───────┬─────────────────┬───────────┘                        │
└──────────┼─────────────────┼────────────────────────────────────┘
           │                 │
    ┌──────┴──────┐   ┌──────┴──────┐
    │             │   │             │
┌───┴───────────┐ │ ┌─┴─────────────┐
│ Worktree A    │ │ │ Worktree B    │
│ ┌───────────┐ │ │ │ ┌───────────┐ │
│ │ Child     │ │ │ │ │ Child     │ │
│ │ Agent 1   │ │ │ │ │ Agent 2   │ │
│ │           │ │ │ │ │           │ │
│ │ IPC Client│ │ │ │ │ IPC Client│ │
│ └───────────┘ │ │ │ └───────────┘ │
│ feat/auth     │ │ │ feat/tests    │
└───────────────┘ │ └───────────────┘
                  │
           (More worktrees...)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IPC Mechanism | Unix Domain Sockets | Fast, bidirectional, connection-based, built-in auth via filesystem |
| Process Isolation | Git Worktrees | Share git objects, fast creation, branch isolation, clean cleanup |
| Message Format | Newline-delimited JSON | Simple, debuggable, streaming-friendly |
| Permission Model | Synchronous request/response | User must approve before tool executes |
| Worker Management | Spawn child processes | Full isolation, crash recovery possible |

### Why Not Other Options?

| Alternative | Why Not |
|-------------|---------|
| TCP Sockets | Port conflicts, network overhead, security concerns |
| Named Pipes (FIFO) | Unidirectional, complex for bidirectional communication |
| File-based polling | Slow, race conditions, cleanup issues |
| Shared memory | Complex, overkill for this use case |
| stdio | Already used for LLM output, would conflict |

## Component Design

### 1. IPC Protocol (`src/orchestrate/ipc/protocol.ts`)

#### Message Types

```typescript
type IPCMessageType =
  // Child → Parent
  | 'handshake'           // Initial connection
  | 'permission_request'  // Tool needs approval
  | 'status_update'       // Progress report
  | 'task_complete'       // Work finished
  | 'task_error'          // Work failed
  | 'log'                 // Streaming output
  // Parent → Child
  | 'handshake_ack'       // Connection accepted
  | 'permission_response' // Approval decision
  | 'cancel'              // Stop work
  | 'ping' / 'pong'       // Health check
```

#### Message Envelope

```typescript
interface IPCMessage {
  id: string;        // Unique ID for request/response correlation
  type: IPCMessageType;
  timestamp: number; // Unix timestamp
}
```

#### Key Messages

**Permission Request** (Child → Parent):
```typescript
interface PermissionRequestMessage {
  type: 'permission_request';
  childId: string;
  confirmation: {
    toolName: string;
    input: Record<string, unknown>;
    isDangerous: boolean;
    dangerReason?: string;
    diffPreview?: DiffResult;
  };
}
```

**Permission Response** (Parent → Child):
```typescript
interface PermissionResponseMessage {
  type: 'permission_response';
  requestId: string;  // References original request
  result: 'approve' | 'deny' | 'abort' | { type: 'approve_pattern'; pattern: string };
}
```

#### Serialization

Newline-delimited JSON for easy parsing of streaming data:

```typescript
function serialize(message: IPCMessage): string {
  return JSON.stringify(message) + '\n';
}

function deserialize(data: string): IPCMessage {
  return JSON.parse(data.trim());
}
```

### 2. IPC Server (`src/orchestrate/ipc/server.ts`)

Runs on the commander (parent) side.

```typescript
class IPCServer extends EventEmitter {
  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>

  // Communication
  send(childId: string, message: IPCMessage): boolean
  broadcast(message: IPCMessage): void

  // State
  getConnectedWorkers(): string[]
  isConnected(childId: string): boolean
}
```

**Events emitted:**
- `workerConnected(childId, handshake)`
- `workerDisconnected(childId)`
- `permissionRequest(childId, request)`
- `statusUpdate(childId, status)`
- `taskComplete(childId, result)`
- `taskError(childId, error)`
- `log(childId, log)`

**Connection lifecycle:**
1. Server listens on Unix socket
2. Client connects
3. Client sends handshake with identity
4. Server acknowledges (or rejects)
5. Bidirectional communication begins
6. Ping/pong for health checks
7. Clean disconnect or timeout

### 3. IPC Client (`src/orchestrate/ipc/client.ts`)

Runs on worker (child) agents.

```typescript
class IPCClient extends EventEmitter {
  // Lifecycle
  async connect(): Promise<void>
  async disconnect(): Promise<void>

  // State
  isConnected(): boolean
  isCancelled(): boolean

  // Permission flow (blocking)
  async requestPermission(confirmation: ToolConfirmation): Promise<ConfirmationResult>

  // Status reporting (fire-and-forget)
  sendStatus(status: WorkerStatus, options?: {...}): void
  sendTaskComplete(result: {...}): void
  sendTaskError(error: {...}): void
  sendLog(level: 'text'|'tool'|'info'|'warn'|'error', content: string): void
}
```

**The key method - `requestPermission`:**
```typescript
async requestPermission(confirmation: ToolConfirmation): Promise<ConfirmationResult> {
  // 1. Send permission_request to parent
  // 2. Block waiting for permission_response
  // 3. Return the result ('approve', 'deny', 'abort', or pattern)
  // 4. Timeout after 5 minutes → deny
}
```

### 4. Worktree Manager (`src/orchestrate/worktree.ts`)

Manages git worktrees for worker isolation.

```typescript
class WorktreeManager {
  // Create worktree with new branch
  async create(branchName: string): Promise<WorktreeInfo>

  // Remove worktree (and optionally branch)
  async remove(branchName: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<void>

  // Query
  get(branchName: string): WorktreeInfo | undefined
  list(): WorktreeInfo[]
  async listAll(): Promise<WorktreeInfo[]>  // Including unmanaged

  // Cleanup all managed worktrees
  async cleanup(options?: { deleteBranches?: boolean }): Promise<void>

  // Git status helpers
  async getStatus(branchName: string): Promise<{...}>
  async getCommits(branchName: string): Promise<string[]>
  async getChangedFiles(branchName: string): Promise<string[]>
}
```

**Worktree directory structure:**
```
/path/to/repo/           # Main repository
../codi-worker-feat-auth/   # Worktree for feat/auth branch
../codi-worker-feat-tests/  # Worktree for feat/tests branch
```

### 5. Child Agent (`src/orchestrate/child-agent.ts`)

Wraps the Agent class with IPC-based permission handling.

```typescript
class ChildAgent {
  constructor(config: ChildAgentConfig) {
    this.agent = new Agent({
      // ... normal agent options ...

      // THE KEY: Route permissions through IPC
      onConfirm: async (confirmation) => {
        return this.requestPermission(confirmation);
      }
    });
  }

  private async requestPermission(confirmation: ToolConfirmation): Promise<ConfirmationResult> {
    // Update status to 'waiting_permission'
    this.ipcClient.sendStatus('waiting_permission');

    // Request permission from commander (blocks until user responds)
    const result = await this.ipcClient.requestPermission(confirmation);

    // Update status back to 'thinking'
    this.ipcClient.sendStatus('thinking');

    return result;
  }

  async run(): Promise<WorkerResult> {
    await this.ipcClient.connect();
    // ... run the agent ...
    await this.ipcClient.disconnect();
  }
}
```

### 6. Orchestrator (`src/orchestrate/commander.ts`)

The main coordinator that manages workers and handles permissions.

```typescript
class Orchestrator extends EventEmitter {
  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>

  // Worker management
  async spawnWorker(config: WorkerConfig): Promise<string>
  async cancelWorker(workerId: string): Promise<void>

  // Query
  getWorker(workerId: string): WorkerState | undefined
  getWorkers(): WorkerState[]
  getActiveWorkers(): WorkerState[]

  // Synchronization
  async waitAll(): Promise<WorkerResult[]>
}
```

**Permission handling flow:**
```typescript
private async handlePermissionRequest(childId: string, request: PermissionRequestMessage) {
  // 1. Update worker status to 'waiting_permission'
  // 2. Display context to user (which worker, what tool, what input)
  // 3. Prompt user for decision using readline
  // 4. Send response back to child
  // 5. Update worker status back to 'thinking'
}
```

### 7. Commands (`src/commands/orchestrate-commands.ts`)

User-facing commands for orchestration.

**`/delegate <branch> <task>`**
```bash
/delegate feat/auth "implement OAuth2 flow"
/delegate feat/tests "write tests for auth module" --model haiku
/delegate feat/docs "update README" --provider ollama
```

**`/workers [action]`**
```bash
/workers           # List all workers
/workers status    # Same as list
/workers cancel feat/auth  # Cancel by branch
/workers wait      # Block until all complete
/workers cleanup   # Stop all and remove worktrees
```

## Data Flow

### Permission Request Flow

```
┌─────────┐     ┌─────────────┐     ┌───────────┐     ┌──────┐
│ Child   │     │ IPC Client  │     │ IPC Server│     │ User │
│ Agent   │     │             │     │           │     │      │
└────┬────┘     └──────┬──────┘     └─────┬─────┘     └──┬───┘
     │                 │                  │              │
     │ Tool needs      │                  │              │
     │ permission      │                  │              │
     │─────────────────>                  │              │
     │                 │                  │              │
     │                 │ permission_request              │
     │                 │──────────────────>              │
     │                 │                  │              │
     │                 │                  │ Display to   │
     │                 │                  │ user         │
     │                 │                  │──────────────>
     │                 │                  │              │
     │                 │                  │ User decides │
     │                 │                  │<─────────────│
     │                 │                  │              │
     │                 │ permission_response             │
     │                 │<─────────────────│              │
     │                 │                  │              │
     │ Result          │                  │              │
     │<────────────────│                  │              │
     │                 │                  │              │
     │ Continue or     │                  │              │
     │ abort           │                  │              │
```

### Worker Lifecycle

```
1. User: /delegate feat/auth "implement OAuth"
         │
         v
2. Orchestrator creates worktree
         │
         v
3. Orchestrator spawns child process
         │
         v
4. Child connects via IPC, sends handshake
         │
         v
5. Child runs agent.chat(task)
         │
         ├──> Status: thinking
         │
         ├──> Tool call → permission request → user approves
         │
         ├──> Status: tool_call
         │
         └──> Loop until done
         │
         v
6. Child sends task_complete
         │
         v
7. Orchestrator updates state, emits event
         │
         v
8. Child disconnects, process exits
```

## Configuration

### Worker Configuration

```typescript
interface WorkerConfig {
  id: string;           // Unique worker ID
  branch: string;       // Git branch name
  task: string;         // Task description/prompt
  model?: string;       // Model to use (from model-map)
  provider?: string;    // Provider override
  role?: string;        // Worker role (from codi-models.yaml)
  autoApprove?: string[]; // Tools to auto-approve
  maxIterations?: number;
  timeout?: number;
}
```

### Model-Map Integration (Future)

```yaml
# codi-models.yaml
worker-roles:
  complex-feature:
    model: opus
    autoApprove: [read_file, glob, grep]

  simple-fix:
    model: sonnet
    autoApprove: [read_file, glob, grep, bash]

  tests:
    model: haiku
    autoApprove: [read_file, glob, grep, bash, run_tests]
```

Usage:
```bash
/delegate feat/auth "implement OAuth" --role complex-feature
```

## Error Handling

### Child Crash Recovery

```typescript
proc.on('exit', (code) => {
  if (state.status !== 'complete' && code !== 0) {
    if (state.restartCount < MAX_RESTARTS) {
      // Attempt restart
      await this.restartWorker(workerId);
    } else {
      // Mark as failed
      state.status = 'failed';
      state.error = `Process exited with code ${code}`;
    }
  }
});
```

### Permission Timeout

```typescript
// In IPCClient.requestPermission()
try {
  return await this.waitForResponse(requestId, 300000); // 5 min timeout
} catch (error) {
  if (error instanceof TimeoutError) {
    return 'deny'; // Safe default
  }
  throw error;
}
```

### Connection Lost

```typescript
// In IPCServer
socket.on('close', () => {
  if (state.status !== 'complete') {
    state.status = 'failed';
    state.error = 'Worker disconnected unexpectedly';
    emit('workerFailed', childId, state.error);
  }
});
```

## Security Considerations

1. **Socket Permissions**: Unix socket file inherits filesystem permissions
2. **Process Isolation**: Each worker runs in separate process
3. **Permission Bubbling**: All dangerous operations require user approval
4. **No Network Exposure**: Unix sockets are local-only
5. **Cleanup on Exit**: Worktrees and sockets cleaned up

## Testing Strategy

### Unit Tests
- IPC protocol serialization/deserialization
- Message type guards
- WorktreeManager create/remove (mock git)

### Integration Tests
- IPC server/client communication
- Permission request/response cycle
- Timeout handling

### E2E Tests
- Full workflow: spawn worker → permission → complete
- Multiple workers in parallel
- Crash recovery

## Future Enhancements

1. **CLI Child Mode**: Add `--child-mode` flags to enable running as worker
2. **Web Dashboard**: Real-time view of worker status
3. **Cost Tracking**: Per-worker token usage
4. **Result Aggregation**: Combine outputs from multiple workers
5. **Dependency Graphs**: Workers that depend on other workers' outputs
6. **Remote Workers**: Workers on different machines via TCP

## File Structure

```
src/orchestrate/
├── index.ts              # Module exports
├── types.ts              # Shared types
├── ipc/
│   ├── index.ts          # IPC exports
│   ├── protocol.ts       # Message types & serialization
│   ├── server.ts         # Unix socket server
│   └── client.ts         # Unix socket client
├── worktree.ts           # Git worktree management
├── child-agent.ts        # Agent wrapper with IPC
└── commander.ts          # Orchestrator

src/commands/
└── orchestrate-commands.ts  # /delegate, /workers

tests/
└── orchestrate.test.ts      # Unit & integration tests
```

## References

- [PR #67: Multi-Agent Orchestration](https://github.com/laynepenney/codi/pull/67)
- [PLAN-multi-agent-orchestration.md](./PLAN-multi-agent-orchestration.md) - Original implementation plan
- [PLAN-opencode-features.md](./PLAN-opencode-features.md) - OpenCode feature comparison that inspired this work
- [Node.js net module](https://nodejs.org/api/net.html) - Unix socket API
- [Git Worktrees](https://git-scm.com/docs/git-worktree) - Git documentation
