# Race Condition Fix: IPC Handshake Buffering

## Issue

When using `/delegate` to spawn worker agents, child agents were failing with:

```
Error: Not connected to IPC server
    at IPCClient.send (./dist/orchestrate/ipc/client.js:150:19)
    at IPCClient.sendStatus (./dist/orchestrate/ipc/client.js:112:14)
```

## Root Cause

The IPC client was setting `this.connected = true` **before** the handshake completed, causing a race condition:

```typescript
// ❌ Before (race condition)
this.socket.on('connect', async () => {
  try {
    this.connected = true;  // ← Marked connected BEFORE handshake
    await this.performHandshake();  // ← Handshake still in progress
    this.emit('connected');
  }
```

**The Race:**
1. Socket connects → `connected = true`
2. Handshake starts (async)
3. Agent begins executing immediately
4. `onToolCall` → `sendStatus()` → calls `send()`
5. `send()` checks `this.connected` → true ✅
6. **BUT** handshake hasn't completed yet
7. Server hasn't registered the worker → drops message
8. Later calls fail with "Not connected to IPC server"

## Solution: Buffer During Handshake

Implemented **handshake status tracking** and **message buffering**:

### 1. Track Handshake State

```typescript
export class IPCClient extends EventEmitter {
  private connected = false;
  private handshaking = false;
  private handshakeComplete = false;
  private pendingStatusUpdates: PendingStatusUpdate[] = [];
}
```

### 2. Set Connected After Handshake

```typescript
// ✅ After (fixed)
this.socket.on('connect', async () => {
  try {
    // Perform handshake BEFORE marking as connected
    await this.performHandshake();

    // Only mark as ready after handshake completes
    this.handshaking = false;
    this.handshakeComplete = true;
    this.connected = true;

    // Send any pending status updates
    this.flushPendingStatusUpdates();

    this.emit('connected');
    resolve();
  }
```

### 3. Buffer Messages During Handshake

```typescript
// All send methods buffer during handshake
sendStatus(status: WorkerStatus, options?): void {
  // Buffer during handshake
  if (!this.handshakeComplete) {
    this.pendingStatusUpdates.push({
      send: () => this.sendStatus(status, options),
    });
    return;
  }

  // Send normally after handshake
  const message = createMessage<StatusUpdateMessage>('status_update', {...});
  this.send(message);
}
```

### 4. Validate Connection Before Sending

```typescript
private send(message: IPCMessage): void {
  if (!this.socket || !this.connected || !this.handshakeComplete) {
    throw new Error('Not connected to IPC server');
  }
  this.socket.write(serialize(message));
}
```

### 5. Flush Pending After Handshake

```typescript
private flushPendingStatusUpdates(): void {
  for (const update of this.pendingStatusUpdates) {
    try {
      update.send();
    } catch {
      // Ignore flush errors
    }
  }
  this.pendingStatusUpdates = [];
}
```

## Timeline

| Phase | State | Can Send Messages? |
|-------|-------|-------------------|
| 1. Socket created | `connected=false`, `handshaking=false` | ❌ No |
| 2. Socket connects | `connected=false`, `handshaking=true` | ❌ Buffered |
| 3. Handshake completes | `connected=true`, `handshaking=false`, `handshakeComplete=true` | ✅ Yes |

## Benefits

1. **No Race Condition**: Messages only sent after handshake completes
2. **No Lost Messages**: Buffered messages sent after handshake
3. **Clear States**: Easy to understand handshake progression
4. **Type Safety**: Status updates properly typed

## One Socket per Orchestrator

To answer the original question: **No, we don't need multiple sockets.**

The IPC server (E26) handles multiple concurrent connections on a single Unix domain socket:
- Multiple workers connect to same socket path
- Server tracks each connection with unique `childId`
- Each connection is buffered separately
- Handshake establishes identity per connection

This is the proper Unix domain socket pattern for multiple clients.

## Testing

```bash
# Start codi
codi --provider ollama --model glm-4.7:cloud

# Delegate a task (should now work without errors)
/delegate task1 "implement a feature"
```

Expected behavior:
- Worker connects
- Handshake completes
- Buffered status updates sent
- Worker executes task successfully
- No "Not connected to IPC server" errors

## Files Modified

- `src/orchestrate/ipc/client.ts` - Added handshake state tracking and buffering

## Related

- Issue: Multi-agent orchestration race condition
- PR: Fix IPC handshake buffering
- Docs: Multi-Agent Orchestration documentation