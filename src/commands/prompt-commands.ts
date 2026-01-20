// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Prompt-only commands that don't take action on files.
 * These commands just ask the AI for information/analysis without modifying anything.
 */

import { registerCommand, type Command, type CommandContext } from './index.js';

/**
 * Generate an explain prompt for code analysis.
 */
function explainPrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /prompt explain <file_path> [function_name]';
  }

  const parts = args.trim().split(/\s+/);
  const filePath = parts[0];
  const functionName = parts[1];

  let prompt = `Please read and explain the code in "${filePath}".`;
  if (functionName) {
    prompt += ` Focus specifically on the "${functionName}" function/class.`;
  }
  prompt += `\n\nProvide:
1. A brief overview of what the code does
2. Key components and their purposes
3. How the code flows / executes
4. Any notable patterns or techniques used`;

  return prompt;
}

/**
 * Generate a review prompt for code review.
 */
function reviewPrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /prompt review <file_path>';
  }

  const filePath = args.trim();

  return `Please read "${filePath}" and provide a thorough code review.

Evaluate:
1. **Correctness**: Are there any bugs or logic errors?
2. **Security**: Any security vulnerabilities (injection, XSS, etc.)?
3. **Performance**: Any inefficiencies or potential bottlenecks?
4. **Maintainability**: Is the code easy to understand and modify?
5. **Best Practices**: Does it follow language/framework conventions?
6. **Error Handling**: Are errors handled appropriately?

Format your review with specific line references and suggestions for improvement.`;
}

/**
 * Generate an analyze prompt for general code analysis.
 */
function analyzePrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path or pattern: /prompt analyze <file_path>';
  }

  const target = args.trim();

  return `Analyze "${target}" and provide insights.

Provide:
1. **Structure**: How is the code organized?
2. **Dependencies**: What does it depend on?
3. **Complexity**: Are there any complex areas?
4. **Suggestions**: What could be improved?

This is an analysis only - do not make any changes.`;
}

/**
 * Generate a summarize prompt for code summarization.
 */
function summarizePrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path or pattern: /prompt summarize <file_path>';
  }

  const target = args.trim();

  return `Summarize the code in "${target}".

Provide a concise summary of:
1. The main purpose of the code
2. Key functions/classes and what they do
3. Important data structures
4. External dependencies

Keep the summary brief and focused on what's most important.`;
}

export const promptCommand: Command = {
  name: 'prompt',
  aliases: ['ask', 'info'],
  description: 'Information-only prompts that don\'t modify files',
  usage: '/prompt <type> <args>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || '';
    const subArgs = parts.slice(1).join(' ');

    switch (subcommand) {
      case 'explain':
      case 'e':
        return explainPrompt(subArgs, context);

      case 'review':
      case 'cr':
        return reviewPrompt(subArgs, context);

      case 'analyze':
      case 'a':
        return analyzePrompt(subArgs, context);

      case 'summarize':
      case 'sum':
        return summarizePrompt(subArgs, context);

      case '':
      case 'help':
        return `Usage: /prompt <type> <args>

Information-only commands (no file modifications):
  explain <file> [function]  - Explain code in a file
  review <file>              - Code review for a file
  analyze <file>             - Analyze code structure
  summarize <file>           - Summarize code

Aliases:
  e = explain, cr = review, a = analyze, sum = summarize

Example: /prompt explain src/index.ts main`;

      default:
        return `Unknown prompt type: "${subcommand}". Use: explain, review, analyze, summarize`;
    }
  },
};

// Standalone aliases for common prompts (backwards compatibility)
export const explainCommand: Command = {
  name: 'explain',
  aliases: ['e'],
  description: 'Explain code from a file or selection (alias for /prompt explain)',
  usage: '/explain <file_path> [function_name]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return explainPrompt(args, context);
  },
};

export const reviewCommand: Command = {
  name: 'review',
  aliases: ['cr'],
  description: 'Code review for a file (alias for /prompt review)',
  usage: '/review <file_path>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return reviewPrompt(args, context);
  },
};

export function registerPromptCommands(): void {
  registerCommand(promptCommand);
  registerCommand(explainCommand);
  registerCommand(reviewCommand);
}
