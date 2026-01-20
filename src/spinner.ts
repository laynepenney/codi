// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spinner Manager
 *
 * Centralized spinner management using ora for visual feedback during long operations.
 */

import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Manages a single spinner instance with TTY detection and state management.
 */
class SpinnerManager {
  private spinner: Ora | null = null;
  private enabled: boolean = true;
  private streaming: boolean = false;

  constructor() {
    // Disable spinners in non-TTY environments (piped output)
    this.enabled = process.stdout.isTTY ?? false;
  }

  /**
   * Enable or disable spinners globally.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.spinner) {
      this.stop();
    }
  }

  /**
   * Check if spinners are currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled && !this.streaming;
  }

  /**
   * Mark that streaming output has started (disables spinner).
   */
  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    if (streaming && this.spinner) {
      this.stop();
    }
  }

  /**
   * Start a new spinner with the given text.
   * If a spinner is already running, it will be stopped first.
   */
  start(text: string): void {
    if (!this.isEnabled()) return;

    try {
      if (this.spinner) {
        this.spinner.stop();
      }

      this.spinner = ora({
        text,
        color: 'cyan',
        spinner: 'dots',
        discardStdin: false, // Don't interfere with readline's stdin handling
      }).start();
    } catch {
      // Silently ignore spinner errors - they shouldn't break the app
      this.spinner = null;
    }
  }

  /**
   * Update the spinner text.
   */
  update(text: string): void {
    if (this.spinner && this.isEnabled()) {
      this.spinner.text = text;
    }
  }

  /**
   * Stop the spinner with a success message.
   */
  succeed(text?: string): void {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    }
  }

  /**
   * Stop the spinner with a failure message.
   */
  fail(text?: string): void {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    }
  }

  /**
   * Stop the spinner with a warning message.
   */
  warn(text?: string): void {
    if (this.spinner) {
      this.spinner.warn(text);
      this.spinner = null;
    }
  }

  /**
   * Stop the spinner with an info message.
   */
  info(text?: string): void {
    if (this.spinner) {
      this.spinner.info(text);
      this.spinner = null;
    }
  }

  /**
   * Stop the spinner without any status symbol.
   */
  stop(): void {
    try {
      if (this.spinner) {
        this.spinner.stop();
        this.spinner = null;
      }
    } catch {
      this.spinner = null;
    }
  }

  /**
   * Clear the spinner line completely.
   */
  clear(): void {
    if (this.spinner) {
      this.spinner.clear();
    }
  }

  // ============================================
  // Convenience methods for common operations
  // ============================================

  /**
   * Show "Thinking..." spinner for AI processing.
   */
  thinking(): void {
    this.start(chalk.cyan('Thinking...'));
  }

  /**
   * Show spinner for tool execution start.
   */
  toolStart(name: string): void {
    this.start(chalk.yellow(`Running ${name}...`));
  }

  /**
   * Complete tool execution with success.
   */
  toolSucceed(name: string, details?: string): void {
    const message = details
      ? chalk.green(`✓ ${name}`) + chalk.dim(` (${details})`)
      : chalk.green(`✓ ${name}`);
    this.succeed(message);
  }

  /**
   * Complete tool execution with failure.
   */
  toolFail(name: string, error?: string): void {
    const message = error
      ? chalk.red(`✗ ${name}`) + chalk.dim(` (${error})`)
      : chalk.red(`✗ ${name}`);
    this.fail(message);
  }

  /**
   * Show indexing progress.
   */
  indexing(current: number, total: number, filename?: string): void {
    const progress = `${current}/${total}`;
    const text = filename
      ? chalk.blue(`Indexing ${progress}: ${filename}`)
      : chalk.blue(`Indexing ${progress} files...`);

    if (this.spinner) {
      this.update(text);
    } else {
      this.start(text);
    }
  }

  /**
   * Complete indexing with summary.
   */
  indexingDone(total: number, chunks: number): void {
    this.succeed(chalk.green(`Indexed ${total} files (${chunks} chunks)`));
  }

  /**
   * Show session loading spinner.
   */
  loadingSession(name: string): void {
    this.start(chalk.cyan(`Loading session "${name}"...`));
  }

  /**
   * Show session saving spinner.
   */
  savingSession(name: string): void {
    this.start(chalk.cyan(`Saving session "${name}"...`));
  }

  /**
   * Show API call spinner.
   */
  apiCall(model?: string): void {
    const text = model
      ? chalk.cyan(`Calling ${model}...`)
      : chalk.cyan('Calling API...');
    this.start(text);
  }
}

/**
 * Singleton spinner instance for global use.
 */
export const spinner = new SpinnerManager();
