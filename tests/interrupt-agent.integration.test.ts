// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { getInterruptHandler, destroyInterruptHandler } from '../src/interrupt.js';

describe('ESC Interrupt Integration', () => {
  let interruptHandler: ReturnType<typeof getInterruptHandler>;

  beforeEach(() => {
    // Get interrupt handler
    interruptHandler = getInterruptHandler();
  });

  afterEach(() => {
    // Clean up interrupt handler
    destroyInterruptHandler();
  });

  it('should allow interrupting simulated long-running operations', () => {
    // Track if interrupt was handled
    let interruptCalled = false;
    interruptHandler.setCallback(() => {
      interruptCalled = true;
    });
    
    // Start processing
    interruptHandler.startProcessing();
    
    // Simulate ESC key press during processing
    interruptHandler['handleInterrupt']();
    
    // Interrupt should have been called
    expect(interruptCalled).toBe(true);
    expect(interruptHandler.wasInterrupted()).toBe(true);
  });

  it('should not interrupt when not processing', () => {
    // Track if interrupt was handled
    let interruptCalled = false;
    interruptHandler.setCallback(() => {
      interruptCalled = true;
    });
    
    // Trigger interrupt without starting processing
    interruptHandler['handleInterrupt']();
    
    // Should not have been called since we weren't processing
    expect(interruptCalled).toBe(false);
    expect(interruptHandler.wasInterrupted()).toBe(false);
  });

  it('should clear interrupt state explicitly', () => {
    // Start processing
    interruptHandler.startProcessing();
    
    // Simulate interrupt
    interruptHandler['interruptRequested'] = true;
    expect(interruptHandler.wasInterrupted()).toBe(true);
    
    // Clear interrupt state explicitly
    interruptHandler.clearInterrupt();
    expect(interruptHandler.wasInterrupted()).toBe(false);
  });
});