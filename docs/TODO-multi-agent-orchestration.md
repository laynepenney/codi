# Multi-Agent Orchestration: Remaining Work

## What's Needed for Testing

### Phase 1: Wire Up Child Mode (Required for MVP)

**Add CLI flags to `src/index.ts`:**
```typescript
.option('--child-mode', 'Run as child agent (connects to commander via IPC)')
.option('--socket-path <path>', 'IPC socket path (for child mode)')
.option('--child-id <id>', 'Unique child identifier (for child mode)')
.option('--child-task <task>', 'Task to execute (for child mode)')
```

**Add child mode entry point:**
```typescript
// In main(), before readline setup:
if (options.childMode) {
  const { runChildAgent } = await import('./orchestrate/child-agent.js');
  await runChildAgent({
    socketPath: options.socketPath,
    childId: options.childId,
    task: options.childTask,
    worktree: process.cwd(),
    branch: await getCurrentBranch(),
    provider,
    toolRegistry: globalRegistry,
    systemPrompt,
  });
  process.exit(0);
}
```

**Estimated effort:** ~50 lines of code

### Phase 2: Wire Up Orchestrator Initialization

**Initialize orchestrator in `src/index.ts`:**
```typescript
// Create orchestrator with permission callback
const orchestrator = new Orchestrator({
  repoRoot: process.cwd(),
  readline: rl,
  onPermissionRequest: async (workerId, confirmation) => {
    // Display worker context
    console.log(chalk.yellow(`\n[Worker: ${workerId}] Permission request:`));
    // Use existing promptConfirmationWithSuggestions
    return await promptConfirmationWithSuggestions(rl, confirmation);
  },
});

// Pass to command context
setOrchestrator(orchestrator);
```

**Estimated effort:** ~30 lines of code

### Phase 3: Integration Testing

Once wired up, test with:
```bash
# Terminal 1: Start codi as commander
codi

# In codi:
/delegate feat/test "create a file called hello.txt with 'Hello World'"

# Should see:
# - Worker spawns in new worktree
# - Permission request bubbles up: "Worker feat/test wants to write_file..."
# - Approve the write
# - Worker completes
```

---

## Future Enhancements (Post-MVP)

### Tier 1: High Value, Medium Effort

1. **Worker Dashboard**
   - Real-time TUI showing all worker statuses
   - Token usage per worker
   - Streaming output from each worker

2. **Model-Map Integration**
   - Worker roles in `codi-models.yaml`
   - Per-worker model selection
   - Cost optimization (use cheaper models for simple tasks)

3. **Automatic PR Creation**
   - Workers create PRs on completion
   - Commander can review/merge from CLI

### Tier 2: Medium Value, Medium Effort

4. **Worker Dependencies**
   - Define workflows where Worker B depends on Worker A
   - DAG-based execution

5. **Checkpointing**
   - Save worker state to resume after crash
   - Session persistence per worker

6. **Cost Tracking**
   - Aggregate token usage across workers
   - Budget limits per worker or total

### Tier 3: Exploratory

7. **Remote Workers**
   - TCP sockets instead of Unix sockets
   - Workers on different machines
   - Cloud-based worker pools

8. **Web Dashboard**
   - Real-time web UI for monitoring
   - Remote permission approval
   - Mobile-friendly

9. **AI Commander**
   - Meta-agent that spawns workers
   - Automatic task decomposition
   - Self-healing (restart failed workers)

---

## Patent Considerations

### Potentially Novel Aspects

1. **Permission Bubbling for AI Agents**
   - Child AI agents route permission requests to parent via IPC
   - Maintains human oversight while enabling parallelism
   - Solves the "background agents can't prompt" problem

2. **Git Worktree-Based Agent Isolation**
   - Each AI agent works in its own worktree
   - Shared git objects, separate working directories
   - Branch-based task isolation
   - Automatic cleanup on completion

3. **Hierarchical AI Agent Orchestration with Human-in-the-Loop**
   - Commander agent manages multiple worker agents
   - All dangerous operations require human approval
   - Preserves audit trail through IPC protocol
   - Enables parallel AI development with safety

4. **Unified Permission Model for Multi-Agent Systems**
   - Single user approves/denies for all agents
   - Pattern-based approval ("approve all read_file from any worker")
   - Category-based approval ("approve all workers for read-only ops")

### Prior Art to Research

- Claude Code's existing permission system
- GitHub Copilot Workspace (parallel file editing)
- Devin (autonomous coding agent)
- OpenAI's multi-agent research
- LangChain/LangGraph multi-agent patterns
- AutoGPT and similar autonomous agent systems

### Potential Claims

1. A method for coordinating multiple AI coding agents comprising:
   - Spawning child agent processes in isolated git worktrees
   - Establishing IPC channels between parent and child agents
   - Routing permission requests from children to parent
   - Maintaining human approval for dangerous operations
   - Aggregating results from multiple parallel agents

2. A system for human-supervised parallel AI development comprising:
   - A commander process with user interface
   - Multiple worker processes without user interface
   - A permission bubbling protocol
   - Git worktree-based isolation
   - Unified permission management

### Recommendation

Before pursuing a patent:
1. Document the invention thoroughly (this doc helps)
2. Research prior art more deeply
3. Consult with IP attorney
4. Consider if trade secret might be more appropriate
5. Evaluate business value vs. patent cost

---

## Implementation Priority

```
Week 1: MVP Testing
├── Add CLI flags for child mode
├── Wire up orchestrator initialization
└── Basic integration test

Week 2: Polish
├── Error handling improvements
├── Better status display
└── Unit test coverage

Week 3+: Enhancements
├── Model-map integration
├── Worker dashboard
└── Automatic PR creation
```
