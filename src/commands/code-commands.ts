// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Code commands that take action on files (modify, create, etc).
 * All commands are consolidated under /code <subcommand>.
 * For information-only prompts, see prompt-commands.ts.
 */

import { registerCommand, type Command, type CommandContext } from './index.js';

// Subcommand implementations
function refactorPrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /code refactor <file_path> [focus_area]';
  }

  const parts = args.trim().split(/\s+/);
  const filePath = parts[0];
  const focusArea = parts.slice(1).join(' ');

  let prompt = `Refactor "${filePath}" to improve code quality.`;
  if (focusArea) {
    prompt += ` Focus on: ${focusArea}.`;
  }
  prompt += `\n\nSteps:
1. Read the file using read_file
2. Analyze for improvements:
   - Code readability and clarity
   - DRY violations
   - Function complexity
   - Naming conventions
   - Error handling
3. Use edit_file to apply the improvements

IMPORTANT: Use edit_file to make changes. Do not just output code.`;

  return prompt;
}

function fixPrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path and issue: /code fix <file_path> <issue_description>';
  }

  const parts = args.trim().split(/\s+/);
  const filePath = parts[0];
  const issue = parts.slice(1).join(' ');

  if (!issue) {
    return `Please describe the issue to fix: /code fix ${filePath} <issue_description>`;
  }

  return `Fix this issue in "${filePath}": ${issue}

Steps:
1. Read the file using read_file
2. Identify the root cause
3. Use edit_file to implement the fix
4. Briefly explain what was wrong and how you fixed it

IMPORTANT: Use edit_file to apply the fix. Do not just output code.`;
}

function testPrompt(args: string, context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /code test <file_path> [function_name]';
  }

  const parts = args.trim().split(/\s+/);
  const filePath = parts[0];
  const functionName = parts[1];

  let prompt = `Please read "${filePath}" and generate comprehensive tests.`;
  if (functionName) {
    prompt += ` Focus on testing the "${functionName}" function/method.`;
  }

  // Add framework context
  if (context.projectInfo) {
    const { type, framework } = context.projectInfo;
    if (type === 'node') {
      prompt += `\n\nThis is a ${framework || 'Node.js'} project. Use appropriate testing frameworks (Jest, Vitest, or Mocha).`;
    } else if (type === 'python') {
      prompt += `\n\nThis is a Python project. Use pytest for testing.`;
    }
  }

  prompt += `\n\nInclude:
1. Unit tests for individual functions
2. Edge cases and error conditions
3. Happy path scenarios
4. Mock external dependencies if needed

Create the test file and write the tests.`;

  return prompt;
}

function docPrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /code doc <file_path>';
  }

  const filePath = args.trim();
  const isGlobPattern = filePath.includes('*');

  if (isGlobPattern) {
    return `Add JSDoc documentation to files matching "${filePath}".

Steps:
1. Use glob: {"pattern": "${filePath}"}
2. For EACH file found, use read_file then write_file to add documentation

For each file:
1. Read it with read_file
2. Add JSDoc comments BEFORE each function, class, and interface
3. Use write_file to save the complete documented file

IMPORTANT: Use write_file with the COMPLETE file content including all original code plus your JSDoc comments.`;
  }

  return `Add JSDoc documentation to "${filePath}".

Steps:
1. Use read_file: {"path": "${filePath}"} to see the current code
2. Add JSDoc comments BEFORE each function, class, interface, and type
3. Use write_file to save the complete file with documentation

## Example JSDoc format:
\`\`\`typescript
/**
 * Brief description of what this does.
 * @param paramName - Description of parameter
 * @returns Description of return value
 */
export function example(paramName: string): boolean {
\`\`\`

For interfaces/types:
\`\`\`typescript
/**
 * Description of the interface.
 * @property propName - Description of property
 */
export interface Example {
\`\`\`

CRITICAL: Use write_file with path "${filePath}" and the COMPLETE file content (all original code with JSDoc comments added before each definition).`;
}

function optimizePrompt(args: string, _context: CommandContext): string {
  if (!args.trim()) {
    return 'Please provide a file path: /code optimize <file_path>';
  }

  const filePath = args.trim();

  return `Optimize "${filePath}" for performance.

Steps:
1. Read the file using read_file
2. Analyze for:
   - Algorithm complexity improvements
   - Unnecessary iterations
   - Caching opportunities
   - Async/parallel processing
3. Use edit_file to apply optimizations
4. Briefly explain the improvements

IMPORTANT: Use edit_file to apply changes. Do not just output code.`;
}

// Main /code command with subcommands
export const codeCommand: Command = {
  name: 'code',
  aliases: ['c'],
  description: 'Code action commands that modify files',
  usage: '/code <action> <file_path> [args]',
  taskType: 'code',
  subcommands: ['refactor', 'fix', 'test', 'doc', 'optimize'],
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || '';
    const subArgs = parts.slice(1).join(' ');

    switch (subcommand) {
      case 'refactor':
      case 'r':
        return refactorPrompt(subArgs, context);

      case 'fix':
      case 'f':
        return fixPrompt(subArgs, context);

      case 'test':
      case 't':
        return testPrompt(subArgs, context);

      case 'doc':
      case 'd':
        return docPrompt(subArgs, context);

      case 'optimize':
      case 'opt':
        return optimizePrompt(subArgs, context);

      default:
        return `Unknown code action: "${subcommand}"

Available actions:
  /code refactor <file> [focus]  - Refactor code for quality
  /code fix <file> <issue>       - Fix a bug or issue
  /code test <file> [function]   - Generate tests
  /code doc <file>               - Generate documentation
  /code optimize <file>          - Optimize for performance

Aliases: /c refactor, /c fix, etc.`;
    }
  },
};

// Standalone aliases for common commands
export const refactorAlias: Command = {
  name: 'refactor',
  aliases: ['r'],
  description: 'Alias for /code refactor',
  usage: '/refactor <file_path> [focus_area]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return refactorPrompt(args, context);
  },
};

export const fixAlias: Command = {
  name: 'fix',
  aliases: ['f'],
  description: 'Alias for /code fix',
  usage: '/fix <file_path> <issue_description>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return fixPrompt(args, context);
  },
};

export const testAlias: Command = {
  name: 'test',
  aliases: ['t'],
  description: 'Alias for /code test',
  usage: '/test <file_path> [function_name]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return testPrompt(args, context);
  },
};

// Register all code commands
export function registerCodeCommands(): void {
  registerCommand(codeCommand);
  // Register standalone aliases for convenience
  registerCommand(refactorAlias);
  registerCommand(fixAlias);
  registerCommand(testAlias);
}
