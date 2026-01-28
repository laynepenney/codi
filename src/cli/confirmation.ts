// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Confirmation Utilities
 *
 * Functions for formatting and prompting tool confirmations.
 */

import chalk from 'chalk';
import type { Interface } from 'readline';
import type { ToolConfirmation, ConfirmationResult } from '../agent.js';
import { formatDiffForTerminal, truncateDiff } from '../diff.js';

/**
 * Format a tool confirmation for display.
 */
export function formatConfirmation(confirmation: ToolConfirmation): string {
  const { toolName, input, isDangerous, dangerReason, diffPreview, approvalSuggestions, securityWarning } = confirmation;

  let display = '';

  if (isDangerous) {
    display += chalk.red.bold('⚠️  DANGEROUS OPERATION\n');
    display += chalk.red(`   Reason: ${dangerReason}\n\n`);
  }

  // Display security model warning if present
  if (securityWarning) {
    const riskColor = securityWarning.riskScore >= 7 ? chalk.red :
                      securityWarning.riskScore >= 4 ? chalk.yellow : chalk.green;
    display += chalk.magenta.bold('🔒 Security Analysis\n');
    display += riskColor(`   Risk: ${securityWarning.riskScore}/10`);
    display += chalk.dim(` (${securityWarning.latencyMs}ms)\n`);
    if (securityWarning.threats.length > 0) {
      display += chalk.yellow(`   Threats: ${securityWarning.threats.slice(0, 3).join(', ')}\n`);
    }
    if (securityWarning.reasoning) {
      display += chalk.dim(`   ${securityWarning.reasoning.slice(0, 100)}${securityWarning.reasoning.length > 100 ? '...' : ''}\n`);
    }
    display += '\n';
  }

  display += chalk.yellow(`Tool: ${toolName}\n`);

  // Format input based on tool type
  if (toolName === 'bash') {
    display += chalk.dim(`Command: ${input.command}\n`);

    // Show approval suggestions for non-dangerous bash commands
    if (!isDangerous && approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar commands?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else if (toolName === 'write_file' || toolName === 'edit_file') {
    display += chalk.dim(`Path: ${input.path}\n`);

    // Show diff preview if available
    if (diffPreview) {
      display += chalk.dim(`Changes: ${diffPreview.summary}\n`);
      if (diffPreview.isNewFile) {
        display += chalk.green('(New file)\n');
      }
      display += '\n';

      // Format and display the diff
      const truncatedDiff = truncateDiff(diffPreview.unifiedDiff, 40);
      const formattedDiff = formatDiffForTerminal(truncatedDiff);
      display += formattedDiff + '\n';
    } else {
      // Fallback to old behavior if no diff preview
      if (toolName === 'write_file') {
        const content = input.content as string | undefined;
        if (content !== undefined) {
          const lines = content.split('\n').length;
          display += chalk.dim(`Content: ${lines} lines, ${content.length} chars\n`);
        } else {
          display += chalk.red(`Content: (missing - model did not provide content)\n`);
        }
      } else {
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        if (oldStr !== undefined) {
          display += chalk.dim(`Replace: "${oldStr.slice(0, 50)}${oldStr.length > 50 ? '...' : ''}"\n`);
        } else {
          display += chalk.red(`Replace: (missing)\n`);
        }
        if (newStr !== undefined) {
          display += chalk.dim(`With: "${newStr.slice(0, 50)}${newStr.length > 50 ? '...' : ''}"\n`);
        } else {
          display += chalk.red(`With: (missing)\n`);
        }
      }
    }

    // Show approval suggestions for file tools
    if (approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar file operations?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else if (toolName === 'insert_line' || toolName === 'patch_file') {
    display += chalk.dim(`Path: ${input.path}\n`);

    // Show approval suggestions for other file tools
    if (approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar file operations?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else {
    display += chalk.dim(JSON.stringify(input, null, 2).slice(0, 200) + '\n');
  }

  return display;
}

/**
 * Extract a short detail string from a confirmation for display.
 */
export function formatConfirmationDetail(confirmation: ToolConfirmation): string | null {
  const input = confirmation.input as Record<string, unknown>;
  const command = typeof input.command === 'string' ? input.command : null;
  if (command) {
    return `command: ${command}`;
  }
  const filePath = typeof input.file_path === 'string' ? input.file_path : null;
  if (filePath) {
    return `file: ${filePath}`;
  }
  const path = typeof input.path === 'string' ? input.path : null;
  if (path) {
    return `path: ${path}`;
  }
  return null;
}

/**
 * Strip ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Prompt user for confirmation using readline.
 */
export function promptConfirmation(
  rl: Interface,
  message: string
): Promise<ConfirmationResult> {
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      const lower = (answer || '').toLowerCase().trim();
      if (lower === 'y' || lower === 'yes') {
        resolve('approve');
      } else if (lower === 'a' || lower === 'abort') {
        resolve('abort');
      } else {
        resolve('deny');
      }
    });
  });
}

/**
 * Prompt user for confirmation with approval suggestions.
 */
export function promptConfirmationWithSuggestions(
  rl: Interface,
  confirmation: ToolConfirmation
): Promise<ConfirmationResult> {
  const { isDangerous, approvalSuggestions } = confirmation;

  // Dangerous commands or no suggestions - simple prompt
  if (isDangerous || !approvalSuggestions) {
    const promptText = isDangerous
      ? chalk.red.bold('Approve? [y/N/abort] ')
      : chalk.yellow('Approve? [y/N/abort] ');
    return promptConfirmation(rl, promptText);
  }

  // Build dynamic prompt with options
  const categoryCount = approvalSuggestions.matchedCategories.length;
  let options = 'y/n';
  if (approvalSuggestions.suggestedPattern) {
    options += '/p';
  }
  if (categoryCount > 0) {
    options += categoryCount > 1 ? `/1-${categoryCount}` : '/1';
  }
  options += '/abort';

  const promptText = chalk.yellow(`Approve? [${options}] `);

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      const lower = (answer || '').toLowerCase().trim();

      if (lower === 'y' || lower === 'yes') {
        resolve('approve');
      } else if (lower === 'a' || lower === 'abort') {
        resolve('abort');
      } else if (lower === 'p' || lower === 'pattern') {
        resolve({
          type: 'approve_pattern',
          pattern: approvalSuggestions.suggestedPattern,
        });
      } else if (/^\d+$/.test(lower)) {
        const index = parseInt(lower, 10) - 1;
        if (index >= 0 && index < approvalSuggestions.matchedCategories.length) {
          resolve({
            type: 'approve_category',
            categoryId: approvalSuggestions.matchedCategories[index].id,
          });
        } else {
          resolve('deny');
        }
      } else {
        resolve('deny');
      }
    });
  });
}
