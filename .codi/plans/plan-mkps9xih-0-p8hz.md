# Plan: create a plan for implementing arrow key selection. Currently there has been some work done but it does not work

**Created:** 2026-01-22T18:26:43.817Z
**Status:** Planning

## Task
create a plan for implementing arrow key selection. Currently there has been some work done but it does not work

## Analysis

### Existing Implementation
The codebase already has arrow key selection implemented in `src/index.ts` for the `promptSessionSelection` function (lines 794-885). The function displays a list of sessions and allows navigation using arrow keys.

### Current Problem
The arrow key selection does not work due to conflicts in stdin handling:

1. **Readline Already Active**: The main readline interface (`rl`) is already created and listening for input (line 2960). When `promptSessionSelection` is called, it tries to directly access `process.stdin` while readline is using it.

2. **Paste Interceptor**: Stdin is piped through a `pasteInterceptor` (line 2954-2961), which creates a wrapper around stdin. Direct raw mode on `process.stdin` conflicts with this.

3. **Keypress Event Not Firing**: The code uses `process.stdin.on('keypress', keypressHandler)` (line 880), but this event may not fire when:
   - Readline is already handling stdin
   - Paste interceptor is intercepting events
   - Raw mode conflicts with readline's mode

4. **Call Context**: `promptSessionSelection` is called during startup (line 3320 from `resolveResumeSessionName`), before the main REPL loop starts, but after readline is created.

### Flow Analysis
```
main() -> createInterface() -> pasteInterceptor pipes stdin -> 
resolveResumeSessionName() -> promptSessionSelection() -> 
tries to use raw mode + keypress on already-piped stdin ❌
```

### Root Cause
The function assumes it has exclusive access to `process.stdin`, but:
- Readline is already active with its own input handling
- The paste interceptor sits between the terminal and readline
- Direct raw mode + keypress listeners on stdin conflict with readline's internal state

### Solution Approach
Use readline-based input handling instead of direct stdin manipulation:
1. Temporarily pause readline input
2. Use a simple number-based prompt (already implemented as fallback)
3. OR: Use readline's line event with a custom prefix to simulate selection
4. OR: Use the `enquirer` package (already installed as dependency) for proper TUI

### Recommended Solution
Implement a readline-compatible selection interface that:
1. Doesn't conflict with the existing readline setup
2. Provides similar arrow key navigation
3. Uses readline's line event for input handling
4. Restores readline state properly after selection

## Steps

### Step 1: Create isolated stdin handler module
- Create `src/session-selection.ts` - a new module to handle session selection
- Implement a class that manages stdin state properly
- Handle raw mode switching without conflicting with readline
- Add proper cleanup and state restoration

### Step 2: Rewrite promptSessionSelection function
- Replace the current implementation with the new module
- Use the new stdin handler instead of direct process.stdin manipulation
- Ensure readline is paused before entering selection mode
- Restore readline state after selection completes

### Step 3: Add proper cursor control
- Implement ANSI escape codes for cursor positioning
- Avoid clearing the entire screen (jarring experience)
- Only re-render the selection list portion
- Preserve the command prompt area

### Step 4: Handle edge cases
- Non-TTY terminals (keep existing fallback)
- Interruption by Ctrl+C
- Piped input scenarios
- Small terminal windows

### Step 5: Add tests
- Create unit tests for the session selection module
- Test TTY detection
- Test keypress handling
- Test cleanup procedures

### Step 6: Update documentation
- Add comments explaining the approach
- Document why raw mode + readline conflict
- Add usage examples in CLAUDE.md if needed

## Progress
- [x] Phase 1: Exploration - Analyzed existing implementation, identified root cause
- [x] Phase 2: Planning - Created detailed implementation plan
- [ ] Phase 3: Confirmation - Awaiting user approval
- [ ] Phase 4: Execution - Steps not started
- [ ] Phase 5: Summary - Not complete
