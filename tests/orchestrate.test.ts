// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  serialize,
  deserialize,
  generateMessageId,
  createMessage,
  isHandshake,
  isPermissionRequest,
  isStatusUpdate,
  isTaskComplete,
  type IPCMessage,
  type HandshakeMessage,
  type PermissionRequestMessage,
  type StatusUpdateMessage,
} from '../src/orchestrate/ipc/protocol.js';

describe('IPC Protocol', () => {
  describe('serialization', () => {
    it('should serialize and deserialize messages', () => {
      const message: IPCMessage = {
        id: 'test-id',
        type: 'ping',
        timestamp: 1234567890,
      };

      const serialized = serialize(message);
      expect(serialized).toContain('"id":"test-id"');
      expect(serialized).toContain('"type":"ping"');
      expect(serialized.endsWith('\n')).toBe(true);

      const deserialized = deserialize(serialized);
      expect(deserialized.id).toBe('test-id');
      expect(deserialized.type).toBe('ping');
      expect(deserialized.timestamp).toBe(1234567890);
    });

    it('should handle newline-delimited JSON', () => {
      const msg1 = serialize({ id: '1', type: 'ping', timestamp: 1 });
      const msg2 = serialize({ id: '2', type: 'pong', timestamp: 2 });

      const combined = msg1 + msg2;
      const lines = combined.split('\n').filter(Boolean);

      expect(lines.length).toBe(2);
      expect(deserialize(lines[0]).id).toBe('1');
      expect(deserialize(lines[1]).id).toBe('2');
    });
  });

  describe('generateMessageId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }
      expect(ids.size).toBe(100);
    });

    it('should have correct format', () => {
      const id = generateMessageId();
      expect(id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });
  });

  describe('createMessage', () => {
    it('should create messages with auto-generated fields', () => {
      const message = createMessage<HandshakeMessage>('handshake', {
        childId: 'child-1',
        worktree: '/path/to/worktree',
        branch: 'feat/test',
        task: 'Test task',
      });

      expect(message.type).toBe('handshake');
      expect(message.id).toMatch(/^msg_/);
      expect(message.timestamp).toBeGreaterThan(0);
      expect(message.childId).toBe('child-1');
      expect(message.branch).toBe('feat/test');
    });
  });

  describe('type guards', () => {
    it('should identify handshake messages', () => {
      const handshake = createMessage<HandshakeMessage>('handshake', {
        childId: 'c1',
        worktree: '/tmp',
        branch: 'main',
        task: 'test',
      });

      expect(isHandshake(handshake)).toBe(true);
      expect(isPermissionRequest(handshake)).toBe(false);
    });

    it('should identify permission request messages', () => {
      const request = createMessage<PermissionRequestMessage>('permission_request', {
        childId: 'c1',
        confirmation: {
          toolName: 'bash',
          input: { command: 'ls' },
          isDangerous: false,
        },
      });

      expect(isPermissionRequest(request)).toBe(true);
      expect(isHandshake(request)).toBe(false);
    });

    it('should identify status update messages', () => {
      const status = createMessage<StatusUpdateMessage>('status_update', {
        childId: 'c1',
        status: 'thinking',
      });

      expect(isStatusUpdate(status)).toBe(true);
      expect(isTaskComplete(status)).toBe(false);
    });
  });
});

describe('WorktreeManager', () => {
  // Note: These tests would require a git repository
  // For now, we test the interface contract

  it('should have correct interface shape', async () => {
    // Import dynamically to verify module exports
    const { WorktreeManager } = await import('../src/orchestrate/worktree.js');

    // Just verify the class exists and has expected methods
    expect(typeof WorktreeManager).toBe('function');

    // Create instance with mock config (won't actually work without git)
    const manager = new WorktreeManager({
      repoRoot: '/tmp/fake-repo',
      worktreeDir: '/tmp/worktrees',
      prefix: 'test-',
      baseBranch: 'main',
    });

    expect(typeof manager.create).toBe('function');
    expect(typeof manager.remove).toBe('function');
    expect(typeof manager.list).toBe('function');
    expect(typeof manager.cleanup).toBe('function');
  });
});

describe('Orchestrator', () => {
  it('should have correct interface shape', async () => {
    const { Orchestrator } = await import('../src/orchestrate/commander.js');

    expect(typeof Orchestrator).toBe('function');

    // Verify config interface
    const config = {
      repoRoot: '/tmp/fake-repo',
      socketPath: '/tmp/test.sock',
    };

    const orch = new Orchestrator(config);

    expect(typeof orch.start).toBe('function');
    expect(typeof orch.stop).toBe('function');
    expect(typeof orch.spawnWorker).toBe('function');
    expect(typeof orch.cancelWorker).toBe('function');
    expect(typeof orch.getWorkers).toBe('function');
    expect(typeof orch.waitAll).toBe('function');
  });
});

describe('ChildAgent', () => {
  it('should have correct interface shape', async () => {
    const { ChildAgent } = await import('../src/orchestrate/child-agent.js');

    expect(typeof ChildAgent).toBe('function');
  });
});

describe('IPCServer', () => {
  it('should have correct interface shape', async () => {
    const { IPCServer } = await import('../src/orchestrate/ipc/server.js');

    expect(typeof IPCServer).toBe('function');

    const server = new IPCServer('/tmp/test-server.sock');

    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
    expect(typeof server.send).toBe('function');
    expect(typeof server.broadcast).toBe('function');
    expect(typeof server.getConnectedWorkers).toBe('function');
    expect(typeof server.isConnected).toBe('function');
  });
});

describe('IPCClient', () => {
  it('should have correct interface shape', async () => {
    const { IPCClient } = await import('../src/orchestrate/ipc/client.js');

    expect(typeof IPCClient).toBe('function');

    const client = new IPCClient({
      socketPath: '/tmp/test-client.sock',
      childId: 'test-child',
      worktree: '/tmp/worktree',
      branch: 'test-branch',
      task: 'test task',
    });

    expect(typeof client.connect).toBe('function');
    expect(typeof client.disconnect).toBe('function');
    expect(typeof client.isConnected).toBe('function');
    expect(typeof client.isCancelled).toBe('function');
    expect(typeof client.requestPermission).toBe('function');
    expect(typeof client.sendStatus).toBe('function');
    expect(typeof client.sendTaskComplete).toBe('function');
    expect(typeof client.sendTaskError).toBe('function');
    expect(typeof client.sendLog).toBe('function');
  });
});

describe('Module Exports', () => {
  it('should export all public types and classes', async () => {
    const orchestrate = await import('../src/orchestrate/index.js');

    // Types from types.ts
    expect(orchestrate.DEFAULT_ORCHESTRATOR_OPTIONS).toBeDefined();

    // IPC Protocol
    expect(orchestrate.serialize).toBeDefined();
    expect(orchestrate.deserialize).toBeDefined();
    expect(orchestrate.createMessage).toBeDefined();
    expect(orchestrate.generateMessageId).toBeDefined();

    // Type guards
    expect(orchestrate.isHandshake).toBeDefined();
    expect(orchestrate.isPermissionRequest).toBeDefined();
    expect(orchestrate.isStatusUpdate).toBeDefined();
    expect(orchestrate.isTaskComplete).toBeDefined();
    expect(orchestrate.isTaskError).toBeDefined();
    expect(orchestrate.isLog).toBeDefined();
    expect(orchestrate.isHandshakeAck).toBeDefined();
    expect(orchestrate.isPermissionResponse).toBeDefined();
    expect(orchestrate.isCancel).toBeDefined();
    expect(orchestrate.isPing).toBeDefined();
    expect(orchestrate.isPong).toBeDefined();

    // Classes
    expect(orchestrate.IPCServer).toBeDefined();
    expect(orchestrate.IPCClient).toBeDefined();
    expect(orchestrate.WorktreeManager).toBeDefined();
    expect(orchestrate.ChildAgent).toBeDefined();
    expect(orchestrate.Orchestrator).toBeDefined();
    expect(orchestrate.runChildAgent).toBeDefined();
  });
});
