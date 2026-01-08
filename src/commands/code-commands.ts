import { registerCommand, type Command, type CommandContext } from './index.js';

export const explainCommand: Command = {
  name: 'explain',
  aliases: ['e'],
  description: 'Explain code from a file or selection',
  usage: '/explain <file_path> [function_name]',
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
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /refactor <file_path> [focus_area]';
    }

    const parts = args.trim().split(/\s+/);
    const filePath = parts[0];
    const focusArea = parts.slice(1).join(' ');

    let prompt = `Please read "${filePath}" and suggest refactoring improvements.`;
    if (focusArea) {
      prompt += ` Focus on: ${focusArea}.`;
    }
    prompt += `\n\nConsider:
1. Code readability and clarity
2. DRY (Don't Repeat Yourself) violations
3. Function/method length and complexity
4. Naming conventions
5. Error handling
6. Performance optimizations

After analysis, implement the most impactful improvements.`;

    return prompt;
  },
};

export const fixCommand: Command = {
  name: 'fix',
  aliases: ['f'],
  description: 'Fix bugs or issues in code',
  usage: '/fix <file_path> <issue_description>',
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

    return `Please read "${filePath}" and fix the following issue: ${issue}

Steps:
1. Read the file to understand the current implementation
2. Identify the root cause of the issue
3. Implement a fix
4. Explain what was wrong and how you fixed it`;
  },
};

export const testCommand: Command = {
  name: 'test',
  aliases: ['t'],
  description: 'Generate tests for code',
  usage: '/test <file_path> [function_name]',
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
  usage: '/doc <file_path>',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /doc <file_path>';
    }

    const filePath = args.trim();

    return `Please read "${filePath}" and add comprehensive documentation.

Add:
1. File/module-level documentation explaining purpose
2. JSDoc/docstrings for all functions, classes, and methods
3. Parameter descriptions and return types
4. Usage examples where helpful
5. Any important notes or warnings

Update the file with the documentation.`;
  },
};

export const optimizeCommand: Command = {
  name: 'optimize',
  aliases: ['opt'],
  description: 'Optimize code for performance',
  usage: '/optimize <file_path>',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please provide a file path: /optimize <file_path>';
    }

    const filePath = args.trim();

    return `Please read "${filePath}" and optimize for performance.

Analyze:
1. Algorithm complexity - can any O(n²) become O(n)?
2. Unnecessary iterations or redundant operations
3. Memory usage and potential leaks
4. Caching opportunities
5. Async/parallel processing opportunities
6. Database query optimization (if applicable)

Implement the optimizations and explain the improvements.`;
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
