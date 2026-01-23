import { clearScreenDown, cursorTo, emitKeypressEvents, Interface as ReadlineInterface, moveCursor } from 'readline';
import { SessionInfo, formatSessionInfo } from './session.js';
import chalk from 'chalk';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function countRenderedRows(lines: string[], columns: number): number {
  if (lines.length === 0) return 0;
  const width = Math.max(1, columns);
  let rows = 0;
  for (const line of lines) {
    const plain = stripAnsi(line);
    const len = plain.length;
    rows += Math.max(1, Math.ceil(len / width));
  }
  return rows;
}

/**
 * Options for session selection
 */
interface SessionSelectionOptions {
  /** Whether to use arrow key navigation (default: true) */
  useNavigation?: boolean;
  /** Custom prompt message (default: 'Select a session to resume:') */
  promptMessage?: string;
}

/**
 * Result of session selection
 */
interface SessionSelectionResult {
  /** Selected session or null if cancelled */
  session: SessionInfo | null;
  /** Whether the selection was cancelled */
  cancelled: boolean;
}

/**
 * Enhanced session selector with arrow key navigation that works alongside readline
 */
export class SessionSelector {
  private rl: ReadlineInterface;
  private sessions: SessionInfo[];
  private options: Required<SessionSelectionOptions>;
  private selectedIndex: number = 0;
  private keypressHandler: ((chunk: Buffer, key: any) => void) | null = null;
  private renderedRows = 0;

  constructor(rl: ReadlineInterface, sessions: SessionInfo[], options?: SessionSelectionOptions) {
    this.rl = rl;
    this.sessions = sessions;
    this.options = {
      useNavigation: true,
      promptMessage: 'Select a session to resume:',
      ...options
    };
    this.selectedIndex = 0;
  }

  /**
   * Prompt user to select a session with arrow key navigation
   */
  async selectSession(): Promise<SessionSelectionResult> {
    // If no sessions or navigation disabled, fall back to simple selection
    if (this.sessions.length === 0 || !this.options.useNavigation) {
      return this.simpleSelection();
    }

    return this.interactiveSelection();
  }

  /**
   * Simple selection without arrow keys (number-based selection)
   */
  private async simpleSelection(): Promise<SessionSelectionResult> {
    return new Promise((resolve) => {
      // Display sessions with numbers
      console.log(chalk.bold(`\n${this.options.promptMessage}`));
      this.sessions.forEach((session, index) => {
        console.log(chalk.dim(`  ${index + 1}) ${this.formatSessionInfo(session)}`));
      });

      const promptText = chalk.cyan(`Pick 1-${this.sessions.length} (Enter for 1): `);
      
      // Pause readline temporarily
      this.rl.pause();
      
      // Create a temporary question
      this.rl.question(promptText, (answer) => {
        // Resume readline
        this.rl.resume();
        
        const trimmed = (answer || '').trim();
        if (!trimmed) {
          resolve({ session: this.sessions[0] || null, cancelled: false });
          return;
        }
        
        const choice = Number.parseInt(trimmed, 10);
        if (Number.isNaN(choice) || choice < 1 || choice > this.sessions.length) {
          console.log(chalk.yellow('Invalid selection, using most recent session.'));
          resolve({ session: this.sessions[0] || null, cancelled: false });
          return;
        }
        
        resolve({ session: this.sessions[choice - 1] || null, cancelled: false });
      });
    });
  }

  /**
   * Interactive selection with arrow keys
   */
  private async interactiveSelection(): Promise<SessionSelectionResult> {
    return new Promise((resolve) => {
      // Check if we're in a TTY environment
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        // Fall back to simple selection in non-TTY environments
        this.simpleSelection().then(resolve);
        return;
      }

      const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
      const wasRaw = Boolean(stdin.isRaw);
      const wasStdinPaused = typeof stdin.isPaused === 'function' ? stdin.isPaused() : false;

      // Save current readline state
      const input = (this.rl as { input?: NodeJS.ReadableStream }).input;
      const wasPaused = typeof input?.isPaused === 'function' ? input.isPaused() : false;
      if (!wasPaused) {
        this.rl.pause();
      }

      // Enable raw mode to capture individual key presses
      emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      // Render initial selection
      this.renderSelection();

      // Handle keypress events
      const handleKeypress = (chunk: Buffer, key: any) => {
        if (!key) {
          return;
        }

        // Handle arrow keys
        if (key.name === 'up') {
          this.selectedIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : this.sessions.length - 1;
          this.renderSelection();
          return;
        }

        if (key.name === 'down') {
          this.selectedIndex = this.selectedIndex < this.sessions.length - 1 ? this.selectedIndex + 1 : 0;
          this.renderSelection();
          return;
        }

        // Handle Enter to select
        if (key.name === 'return' || key.name === 'enter') {
          this.cleanup(wasRaw);
          if (!wasPaused && this.rl.resume) {
            this.rl.resume();
          }
          if (!wasStdinPaused) {
            process.stdin.resume();
          }
          process.stdout.write('\n');
          resolve({ session: this.sessions[this.selectedIndex] || null, cancelled: false });
          return;
        }

        // Handle Escape or 'q' to cancel
        if (key.name === 'escape' || (key.name === 'q' && !key.ctrl)) {
          this.cleanup(wasRaw);
          if (!wasPaused && this.rl.resume) {
            this.rl.resume();
          }
          if (!wasStdinPaused) {
            process.stdin.resume();
          }
          process.stdout.write('\n');
          resolve({ session: null, cancelled: true });
          return;
        }

        // Handle Ctrl+C to cancel
        if (key.name === 'c' && key.ctrl) {
          this.cleanup(wasRaw);
          if (!wasPaused && this.rl.resume) {
            this.rl.resume();
          }
          if (!wasStdinPaused) {
            process.stdin.resume();
          }
          process.stdout.write('\n');
          resolve({ session: null, cancelled: true });
          return;
        }

        // Handle number keys (1-9) for quick selection
        if (key.name && /^\d$/.test(key.name)) {
          const num = Number.parseInt(key.name, 10);
          if (num >= 1 && num <= this.sessions.length) {
            this.cleanup(wasRaw);
            if (!wasPaused && this.rl.resume) {
              this.rl.resume();
            }
            if (!wasStdinPaused) {
              process.stdin.resume();
            }
            process.stdout.write('\n');
            resolve({ session: this.sessions[num - 1] || null, cancelled: false });
            return;
          }
        }
      };

      // Set up keypress listener
      process.stdin.on('keypress', handleKeypress);

      // Store handler for cleanup
      this.keypressHandler = handleKeypress;
    });
  }

  /**
   * Render the current selection state
   */
  private renderSelection(): void {
    if (this.renderedRows > 0) {
      cursorTo(process.stdout, 0);
      if (this.renderedRows > 1) {
        moveCursor(process.stdout, 0, -(this.renderedRows - 1));
      }
      clearScreenDown(process.stdout);
    }

    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.bold(this.options.promptMessage));
    for (const [index, session] of this.sessions.entries()) {
      const prefix = index === this.selectedIndex ? chalk.green('▶ ') : '  ';
      const label = index === this.selectedIndex
        ? chalk.bold(this.formatSessionInfo(session))
        : chalk.dim(this.formatSessionInfo(session));
      lines.push(prefix + label);
    }
    lines.push('');
    lines.push(chalk.dim('(Use ↑↓ arrow keys to navigate, Enter to select, Esc/q to cancel)'));
    lines.push(chalk.dim('(Or type a number 1-9 to jump to that session)'));
    lines.push(chalk.cyan('> '));

    process.stdout.write(lines.join('\n'));
    const columns = Math.max(20, process.stdout.columns || 80);
    this.renderedRows = countRenderedRows(lines, columns);
  }

  /**
   * Cleanup resources and restore state
   */
  private cleanup(wasRaw: boolean): void {
    // Restore raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(wasRaw);
    }

    // Remove keypress listener if it exists
    if (this.keypressHandler) {
      process.stdin.removeListener('keypress', this.keypressHandler);
      this.keypressHandler = null;
    }

    if (this.renderedRows > 0) {
      cursorTo(process.stdout, 0);
      if (this.renderedRows > 1) {
        moveCursor(process.stdout, 0, -(this.renderedRows - 1));
      }
      clearScreenDown(process.stdout);
      this.renderedRows = 0;
    }
  }

  /**
   * Format session info for display
   */
  private formatSessionInfo(session: SessionInfo): string {
    return formatSessionInfo(session);
  }
}

/**
 * Prompt user to select a session with arrow key navigation (readline-compatible)
 */
export async function promptSessionSelection(
  rl: ReadlineInterface, 
  sessions: SessionInfo[],
  options?: SessionSelectionOptions
): Promise<SessionInfo | null> {
  const selector = new SessionSelector(rl, sessions, options);
  const result = await selector.selectSession();
  
  if (result.cancelled) {
    console.log('\nCancelled.');
    return null;
  }
  
  return result.session;
}
