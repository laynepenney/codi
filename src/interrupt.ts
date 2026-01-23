// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Interrupt handling for user-triggered interruption via Escape key.
 * Allows users to cancel long-running agent operations by pressing ESC.
 */

import type { Interface } from 'readline';
import * as readline from 'readline';
import chalk from 'chalk';
import { logger } from './logger.js';

/**
 * Callback for when an interruption is triggered.
 */
export type InterruptCallback = () => void;

/**
 * Interrupt handler for readline interface.
 * Allows users to press ESC to interrupt and cancel agent processing.
 */
export class InterruptHandler {
  private rl: Interface | null = null;
  private callback: InterruptCallback | null = null;
  private isProcessing = false;
  private interruptRequested = false;

  constructor() {}

  /**
   * Initialize the interrupt handler with a readline interface.
   */
  initialize(rl: Interface): void {
    this.rl = rl;
    this.setupKeyListener();
  }

  /**
   * Set the callback for interruption events.
   */
  setCallback(callback: InterruptCallback): void {
    this.callback = callback;
  }

  /**
   * Mark that processing has started.
   */
  startProcessing(): void {
    this.isProcessing = true;
    this.interruptRequested = false;
  }

  /**
   * Mark that processing has completed.
   */
  endProcessing(): void {
    this.isProcessing = false;
  }

  /**
   * Check if an interrupt was requested.
   */
  wasInterrupted(): boolean {
    return this.interruptRequested;
  }

  /**
   * Clear the interrupt flag.
   */
  clearInterrupt(): void {
    this.interruptRequested = false;
  }

  /**
   * Set up the key listener to detect ESC key presses.
   */
  private setupKeyListener(): void {
    if (!this.rl) return;

    // Listen for keypress events to detect ESC
    readline.emitKeypressEvents(process.stdin);

    this.rl.on('keypress', (str, key) => {
      // Check for ESC key (ASCII 27)
      if (key && key.name === 'escape') {
        this.handleInterrupt();
      }
    });

    // Also listen on stdin directly as backup when in TTY mode
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);

      process.stdin.on('data', (data: Buffer) => {
        // ESC is ASCII 27
        if (data.length === 1 && data[0] === 27) {
          this.handleInterrupt();
        }
      });
    }
  }

  /**
   * Handle an interrupt request.
   */
  private handleInterrupt(): void {
    if (!this.isProcessing || this.interruptRequested) {
      return;
    }

    this.interruptRequested = true;
    logger.debug('🚫 User pressed ESC - interrupting agent');

    // Call the registered callback
    if (this.callback) {
      try {
        this.callback();
      } catch (error) {
        logger.error(`Interrupt callback error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    this.rl = null;
    this.callback = null;
    this.isProcessing = false;
    this.interruptRequested = false;
  }
}

/**
 * Global interrupt handler instance.
 */
let globalInterruptHandler: InterruptHandler | null = null;

/**
 * Get or create the global interrupt handler.
 */
export function getInterruptHandler(): InterruptHandler {
  if (!globalInterruptHandler) {
    globalInterruptHandler = new InterruptHandler();
  }
  return globalInterruptHandler;
}

/**
 * Destroy the global interrupt handler.
 */
export function destroyInterruptHandler(): void {
  if (globalInterruptHandler) {
    globalInterruptHandler.destroy();
    globalInterruptHandler = null;
  }
}