// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { getInterruptHandler, destroyInterruptHandler } from '../src/interrupt.js';
import type { Interface } from 'readline';
import EventEmitter from 'events';

// Mock readline interface for testing
class MockReadlineInterface extends EventEmitter implements Interface {
  line = '';
  cursor = 0;
  terminal = true;
  
  setPrompt(): void {}
  prompt(): void {}
  question(): void {}
  pause(): this { return this; }
  resume(): this { return this; }
  close(): void {}
  write(): this { return this; }
  getPrompt(): string { return '> '; }
}

describe('Interrupt Handler', () => {
  let interruptHandler: ReturnType<typeof getInterruptHandler>;
  let mockRl: MockReadlineInterface;

  beforeEach(() => {
    // Get fresh interrupt handler for each test
    interruptHandler = getInterruptHandler();
    mockRl = new MockReadlineInterface();
  });

  afterEach(() => {
    // Clean up interrupt handler after each test
    destroyInterruptHandler();
  });

  it('should create a singleton interrupt handler instance', () => {
    const handler1 = getInterruptHandler();
    const handler2 = getInterruptHandler();
    expect(handler1).toBe(handler2);
  });

  it('should track processing state correctly', () => {
    expect(interruptHandler.wasInterrupted()).toBe(false);
    
    interruptHandler.startProcessing();
    expect(interruptHandler['isProcessing']).toBe(true);
    
    interruptHandler.endProcessing();
    expect(interruptHandler['isProcessing']).toBe(false);
  });

  it('should track interrupt requests correctly', () => {
    interruptHandler.startProcessing();
    expect(interruptHandler.wasInterrupted()).toBe(false);
    
    // Simulate interrupt request
    interruptHandler['interruptRequested'] = true;
    expect(interruptHandler.wasInterrupted()).toBe(true);
    
    // Should clear after checking
    interruptHandler.clearInterrupt();
    expect(interruptHandler.wasInterrupted()).toBe(false);
  });

  it('should store and call interrupt callback when ESC key is pressed', () => {
    const callback = vi.fn();
    interruptHandler.setCallback(callback);
    
    // Initialize with mock readline interface
    interruptHandler.initialize(mockRl);
    
    // Start processing to enable interrupt handling
    interruptHandler.startProcessing();
    
    // Simulate ESC keypress event
    mockRl.emit('keypress', null, { name: 'escape' });
    
    // Callback should be called
    expect(callback).toHaveBeenCalled();
    expect(interruptHandler.wasInterrupted()).toBe(true);
  });

  it('should handle callback errors gracefully', () => {
    const errorCallback = vi.fn(() => {
      throw new Error('Test error');
    });
    interruptHandler.setCallback(errorCallback);
    
    // Initialize with mock readline interface
    interruptHandler.initialize(mockRl);
    
    // Start processing to enable interrupt handling
    interruptHandler.startProcessing();
    
    // Should not throw when handling interrupt
    expect(() => {
      mockRl.emit('keypress', null, { name: 'escape' });
    }).not.toThrow();
    
    // Callback should have been attempted
    expect(errorCallback).toHaveBeenCalled();
  });

  it('should not call callback when not processing', () => {
    const callback = vi.fn();
    interruptHandler.setCallback(callback);
    
    // Initialize with mock readline interface
    interruptHandler.initialize(mockRl);
    
    // Not processing, so callback shouldn't be called even with ESC
    mockRl.emit('keypress', null, { name: 'escape' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('should not call callback when already interrupted', () => {
    const callback = vi.fn();
    interruptHandler.setCallback(callback);
    
    // Initialize with mock readline interface
    interruptHandler.initialize(mockRl);
    
    interruptHandler.startProcessing();
    
    // First interrupt should call callback
    mockRl.emit('keypress', null, { name: 'escape' });
    expect(callback).toHaveBeenCalledTimes(1);
    
    // Second interrupt should not call callback again
    callback.mockClear();
    mockRl.emit('keypress', null, { name: 'escape' });
    expect(callback).not.toHaveBeenCalled();
  });

  // Test that we can destroy and recreate the handler
  it('should destroy and recreate handler correctly', () => {
    const handler1 = getInterruptHandler();
    destroyInterruptHandler();
    
    // Should create a new instance after destruction
    const handler2 = getInterruptHandler();
    expect(handler1).not.toBe(handler2);
  });
  
  it('should not trigger interrupt when key is not escape', () => {
    const callback = vi.fn();
    interruptHandler.setCallback(callback);
    
    // Initialize with mock readline interface
    interruptHandler.initialize(mockRl);
    
    interruptHandler.startProcessing();
    
    // Simulate non-ESC keypress event
    mockRl.emit('keypress', 'a', { name: 'a' });
    mockRl.emit('keypress', null, { name: 'enter' });
    
    // Callback should not be called
    expect(callback).not.toHaveBeenCalled();
  });
});