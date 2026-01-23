#!/usr/bin/env node
// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test script for debugging events
 *
 * Usage: node test-debug-events.js
 *
 * Demonstrates all event types emitted by the debug bridge.
 */

import { DebugBridge } from './src/debug-bridge.js';

// Create and enable debug bridge
const bridge = new DebugBridge();
bridge.enable();

console.log('🔍 Debug Bridge Test\n');
console.log('Session ID:', bridge.getSessionId());
console.log('Events file:', bridge.getEventsFile());
console.log('Commands file:', bridge.getCommandsFile());
console.log('');

// Test all event types
console.log('📡 Emitting debug events...\n');

// Session events
bridge.emit('session_start', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
});

bridge.emit('user_input', {
  input: 'Help me fix this bug in my code',
});

bridge.emit('assistant_thinking', {
  message: 'Analyzing the code to identify the issue...',
});

// Tool events
bridge.emit('tool_call_start', {
  toolName: 'read_file',
  input: { path: 'src/utils.ts' },
});

bridge.emit('tool_result', {
  toolName: 'read_file',
  result: 'File content here...',
  success: true,
  duration: 42,
});

// Context events
bridge.emit('context_compaction', {
  before: 15000,
  after: 8000,
  tokensSaved: 7000,
  messagesCompacted: 5,
});

// API events
bridge.emit('api_request', {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  inputTokens: 7500,
});

bridge.emit('api_response', {
  provider: 'anthropic',
  outputTokens: 320,
  latency: 1200,
  finishReason: 'stop',
  toolCalls: 0,
});

bridge.emit('assistant_text', {
  text: 'I found the bug! The issue is on line 42...',
  tokens: 150,
});

// Model events
bridge.emit('model_switch', {
  from: 'claude-opus-4-5-20251101',
  to: 'claude-sonnet-4-20250514',
  reason: 'cost_optimization',
});

// State snapshot
bridge.emit('state_snapshot', {
  messageCount: 15,
  tokenCount: 8200,
  compressionEnabled: true,
  toolCallsPending: 0,
});

// Error event
bridge.emit('error', {
  type: 'ToolExecutionError',
  message: 'File not found: src/missing.ts',
  toolName: 'read_file',
  recoverable: true,
});

// Command event
bridge.emit('command_executed', {
  command: '/status',
  result: 'Current context: 8,200 tokens, 15 messages',
});

// Session end
bridge.emit('session_end', {
  duration: 45000,
  totalTokens: 12000,
  totalCost: 0.15,
  toolCallsTotal: 8,
});

console.log('✅ Events emitted successfully!\n');

// Read and display the events
const { readFileSync, existsSync } = await import('fs');
const eventsFile = bridge.getEventsFile();

if (existsSync(eventsFile)) {
  const content = readFileSync(eventsFile, 'utf8');
  const lines = content.trim().split('\n').filter(l => l);
  
  console.log(`📋 Events written to: ${eventsFile}`);
  console.log(`🔢 Total events: ${lines.length}\n`);

  // Display last few events
  const recentEvents = lines.slice(-5).map(line => {
    const event = JSON.parse(line);
    return `  ${event.sequence}. [${event.type}] ${new Date(event.timestamp).toLocaleTimeString()}`;
  });
  console.log('Recent events:');
  console.log(recentEvents.join('\n'));
  console.log('');

  // Full event list
  console.log('📝 Full event list:');
  lines.forEach(line => {
    const event = JSON.parse(line);
    console.log(`  ${event.sequence}. ${event.type.padEnd(20)} - ${JSON.stringify(event.data).substring(0, 50)}...`);
  });
}

console.log('\n💡 Tip: Monitor live events with:');
console.log(`   tail -f ${eventsFile} | jq`);

// Shutdown
bridge.shutdown();
console.log('\n🔌 Debug bridge shut down.\n');