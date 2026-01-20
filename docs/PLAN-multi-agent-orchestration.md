# Multi-Agent Orchestration Feature

## Problem Statement

When we spawned background Claude agents to work on features in parallel:
- **Agent 1** (non-interactive mode) succeeded - created PR #65
- **Agent 2** (custom commands) got **stuck** with "Permission auto-denied (prompts unavailable)"

The root cause: background agents can't receive interactive permission prompts because they lack a readline interface. The `onConfirm` callback in `src/agent.ts:113` requires user input.

## Solution: Permission Bubbling via IPC

Create an orchestration system where child agents route permission requests to a parent/commander via Unix domain sockets.

```
┌─────────────────────────────────────────────┐
│           Commander (has readline)          │
│  ┌─────────────────────────────────────┐   │
│  │  Unix Socket Server                  │   │
│  │  ~/.codi/orchestrator.sock          │   │
│  └──────────┬──────────────┬───────────┘   │
└─────────────┼──────────────┼───────────────┘
              │              │
       ┌──────┴───┐    ┌─────┴────┐
       │ Worker 1 │    │ Worker 2 │
       │ (IPC     │    │ (IPC     │
       │  Client) │    │  Client) │
       └──────────┘    └──────────┘
        Worktree A      Worktree B
```

## Implementation Plan

### Phase 1: IPC Protocol & Infrastructure

**Files to create:**
- `src/orchestrate/ipc/protocol.ts` - Message types
- `src/orchestrate/ipc/server.ts` - Unix socket server
- `src/orchestrate/ipc/client.ts` - Unix socket client

**Key message types:**
```typescript
type IPCMessageType =
  | 'permission_request'   // Child → Parent
  | 'permission_response'  // Parent → Child
  | 'status_update'        // Child → Parent
  | 'task_complete'        // Child → Parent
```

### Phase 2: Child Agent with IPC

**File to create:** `src/orchestrate/child-agent.ts`

Wraps the existing Agent class with IPC-based `onConfirm`:

```typescript
onConfirm: async (confirmation) => {
  // Send to parent via IPC
  ipcClient.send({ type: 'permission_request', confirmation });
  // Wait for response
  const response = await ipcClient.waitForResponse(requestId);
  return response.result;  // 'approve' | 'deny' | 'abort'
}
```

### Phase 3: Worktree Manager

**File to create:** `src/orchestrate/worktree.ts`

```typescript
class WorktreeManager {
  async create(branchName: string): Promise<WorktreeInfo>
  async remove(branchName: string): Promise<void>
  async cleanup(): Promise<void>  // Remove all managed worktrees
}
```

### Phase 4: Orchestrator (Commander)

**File to create:** `src/orchestrate/commander.ts`

```typescript
class Orchestrator {
  async spawnWorker(config: WorkerConfig): Promise<string>
  async handlePermissionRequest(request): Promise<void>  // Prompts user
  getWorkerStatuses(): WorkerStatus[]
  async waitAll(): Promise<WorkerResult[]>
}
```

### Phase 5: Commands & CLI

**File to create:** `src/commands/orchestrate-commands.ts`

| Command | Description |
|---------|-------------|
| `/delegate <branch> <task>` | Spawn worker in new worktree |
| `/workers` | List active workers |
| `/workers cancel <id>` | Cancel a worker |

**CLI flags to add in `src/index.ts`:**
- `--child-mode` - Run as child agent (IPC client mode)
- `--socket-path <path>` - Parent's socket path
- `--child-id <id>` - Unique child identifier

### Phase 6: Model-Map Integration

Extend `codi-models.yaml` for worker roles:

```yaml
worker-roles:
  complex-feature:
    model: opus
    autoApprove: [read_file, glob, grep]
  simple-fix:
    model: sonnet
    autoApprove: [read_file, glob, grep, bash]
```

Usage: `/delegate feat/auth "implement OAuth" --role complex-feature`

## Files to Modify

| File | Changes |
|------|---------|
| `src/index.ts` | Add `--child-mode` flags, orchestrator init |
| `src/agent.ts` | No changes needed (onConfirm already callback-based) |
| `src/model-map/types.ts` | Add WorkerRole type |

## Files to Create

| File | Purpose |
|------|---------|
| `src/orchestrate/index.ts` | Module exports |
| `src/orchestrate/types.ts` | Shared types |
| `src/orchestrate/ipc/protocol.ts` | IPC message definitions |
| `src/orchestrate/ipc/server.ts` | Unix socket server |
| `src/orchestrate/ipc/client.ts` | Unix socket client |
| `src/orchestrate/child-agent.ts` | Agent wrapper with IPC |
| `src/orchestrate/commander.ts` | Parent orchestrator |
| `src/orchestrate/worktree.ts` | Git worktree management |
| `src/commands/orchestrate-commands.ts` | User commands |

## Verification

1. **Unit tests:** IPC protocol serialization, worktree creation/cleanup
2. **Integration test:** Spawn worker, receive permission request, approve, verify completion
3. **E2E test:**
   ```bash
   codi
   > /delegate feat/test "create a hello.txt file with 'Hello World'"
   # Approve the write_file permission when prompted
   > /workers  # Should show worker completed
   ```

## Key Design Decisions

1. **Unix sockets over TCP** - Faster, no port conflicts, built-in auth via filesystem permissions
2. **Worktrees over separate clones** - Share git objects, faster creation, cleaner cleanup
3. **IPC over shared files** - Real-time, no polling, bidirectional
4. **Existing onConfirm pattern** - No changes to Agent class needed, just wrap the callback
