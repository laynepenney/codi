import { registerCommand, type Command, type CommandContext } from './index.js';

export const explainCommand: Command = {
  name: 'explain',
  aliases: ['e'],
  description: 'Explain code from a file or selection',
  usage: '/explain <file_path> [function_name]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /explain <file_path> [function_name]';
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
  },
};

export const refactorCommand: Command = {
  name: 'refactor',
  aliases: ['r'],
  description: 'Suggest refactoring improvements for code',
  usage: '/refactor <file_path> [focus_area]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /refactor <file_path> [focus_area]';
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
  },
};

export const fixCommand: Command = {
  name: 'fix',
  aliases: ['f'],
  description: 'Fix bugs or issues in code',
  usage: '/fix <file_path> <issue_description>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path and issue: /fix <file_path> <issue_description>';
    }

    const parts = args.trim().split(/\s+/);
    const filePath = parts[0];
    const issue = parts.slice(1).join(' ');

    if (!issue) {
      return `Please describe the issue to fix: /fix ${filePath} <issue_description>`;
    }

    return `Fix this issue in "${filePath}": ${issue}

Steps:
1. Read the file using read_file
2. Identify the root cause
3. Use edit_file to implement the fix
4. Briefly explain what was wrong and how you fixed it

IMPORTANT: Use edit_file to apply the fix. Do not just output code.`;
  },
};

export const testCommand: Command = {
  name: 'test',
  aliases: ['t'],
  description: 'Generate tests for code',
  usage: '/test <file_path> [function_name]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /test <file_path> [function_name]';
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
  },
};

export const reviewCommand: Command = {
  name: 'review',
  aliases: ['cr'],
  description: 'Code review for a file',
  usage: '/review <file_path>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /review <file_path>';
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
  },
};

export const docCommand: Command = {
  name: 'doc',
  aliases: ['d'],
  description: 'Generate documentation for code',
  usage: '/doc <file_path_or_pattern>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /doc <file_path>';
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
  },
};

export const optimizeCommand: Command = {
  name: 'optimize',
  aliases: ['opt'],
  description: 'Optimize code for performance',
  usage: '/optimize <file_path>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /optimize <file_path>';
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
  },
};

// Register all commands
export function registerCodeCommands(): void {
  registerCommand(explainCommand);
  registerCommand(refactorCommand);
  registerCommand(fixCommand);
  registerCommand(testCommand);
  registerCommand(reviewCommand);
  registerCommand(docCommand);
  registerCommand(optimizeCommand);
}
