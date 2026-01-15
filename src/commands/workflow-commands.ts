// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { registerCommand, type Command, type CommandContext } from './index.js';

export const newCommand: Command = {
  name: 'new',
  aliases: ['create'],
  description: 'Create a new component, file, or feature',
  usage: '/new <type> <name>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      const types = context.projectInfo?.type === 'node'
        ? 'component, hook, page, api, service, util, test'
        : 'module, class, function, test';

      return `Usage: /new <type> <name>\n\nAvailable types: ${types}\n\nExample: /new component UserProfile`;
    }

    const parts = args.trim().split(/\s+/);
    const type = parts[0].toLowerCase();
    const name = parts.slice(1).join(' ');

    if (!name) {
      return `Please provide a name: /new ${type} <name>`;
    }

    let prompt = `Create a new ${type} named "${name}".`;

    // Add framework-specific context
    if (context.projectInfo) {
      const { framework, language } = context.projectInfo;
      prompt += `\n\nProject context: ${language}`;
      if (framework) {
        prompt += ` with ${framework}`;
      }

      // Framework-specific templates
      if (framework === 'React' || framework === 'Next.js') {
        if (type === 'component') {
          prompt += `\n\nCreate a functional React component with:
- TypeScript types for props
- Proper file structure (component + styles if needed)
- Export from index if using barrel exports`;
        } else if (type === 'hook') {
          prompt += `\n\nCreate a custom React hook with:
- Proper TypeScript types
- JSDoc documentation
- Return type annotation`;
        }
      }
    }

    prompt += `\n\nSteps:
1. Determine the appropriate file location based on project structure
2. Create the file with proper boilerplate
3. Add necessary imports
4. Include basic documentation`;

    return prompt;
  },
};

export const scaffoldCommand: Command = {
  name: 'scaffold',
  aliases: ['scaf'],
  description: 'Scaffold a new feature with multiple files',
  usage: '/scaffold <feature_name>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Usage: /scaffold <feature_name>\n\nExample: /scaffold user-authentication';
    }

    const featureName = args.trim();

    let prompt = `Scaffold a complete "${featureName}" feature for this project.`;

    if (context.projectInfo) {
      const { framework, type } = context.projectInfo;

      if (type === 'node' && (framework === 'React' || framework === 'Next.js')) {
        prompt += `\n\nFor this React/Next.js project, create:
1. Component(s) in the appropriate directory
2. Types/interfaces file
3. Hook(s) if stateful logic is needed
4. Test file(s)
5. Update any barrel exports (index.ts)`;
      } else if (type === 'node' && (framework === 'Express' || framework === 'Fastify')) {
        prompt += `\n\nFor this backend project, create:
1. Route/controller file
2. Service/business logic file
3. Types/interfaces
4. Validation schemas
5. Test file(s)`;
      }
    }

    prompt += `\n\nFirst, explore the existing project structure to follow established patterns, then create the necessary files.`;

    return prompt;
  },
};

export const migrateCommand: Command = {
  name: 'migrate',
  description: 'Help migrate code between patterns or versions',
  usage: '/migrate <from> <to> [file_path]',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return `Usage: /migrate <from> <to> [file_path]

Examples:
  /migrate class-component functional-component src/components/
  /migrate callbacks promises src/utils/api.ts
  /migrate commonjs esm src/`;
    }

    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return 'Please specify both source and target patterns: /migrate <from> <to> [file_path]';
    }

    const from = parts[0];
    const to = parts[1];
    const path = parts[2] || '.';

    return `Migrate code from "${from}" to "${to}" pattern in "${path}".

Steps:
1. Find all files that use the "${from}" pattern
2. For each file, analyze the current implementation
3. Convert to the "${to}" pattern while preserving functionality
4. Ensure all tests still pass (run tests after migration)
5. Update any imports or dependencies as needed

Start by listing files that need migration, then proceed with the changes.`;
  },
};

export const debugCommand: Command = {
  name: 'debug',
  aliases: ['investigate'],
  description: 'Help debug an issue',
  usage: '/debug <description>',
  taskType: 'complex',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return 'Please describe the issue: /debug <description>\n\nExample: /debug "TypeError: Cannot read property x of undefined in UserList component"';
    }

    const issue = args.trim();

    return `Help debug this issue: ${issue}

Debugging approach:
1. Search for relevant code using grep to find where this might occur
2. Read the relevant files to understand the context
3. Identify potential causes
4. Suggest specific fixes with explanations
5. If possible, implement the fix

Start by searching for code related to this error.`;
  },
};

export const setupCommand: Command = {
  name: 'setup',
  description: 'Help set up or configure project tooling',
  usage: '/setup <tool>',
  taskType: 'code',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    if (!args.trim()) {
      return `Usage: /setup <tool>

Available setups:
  typescript - Add TypeScript configuration
  eslint     - Add ESLint configuration
  prettier   - Add Prettier configuration
  testing    - Add testing framework
  ci         - Add CI/CD configuration
  docker     - Add Docker configuration`;
    }

    const tool = args.trim().toLowerCase();

    const setups: Record<string, string> = {
      typescript: `Set up TypeScript for this project:
1. Check if tsconfig.json exists
2. Install typescript and required @types packages
3. Create/update tsconfig.json with appropriate settings
4. Update package.json scripts
5. Rename .js files to .ts if needed`,

      eslint: `Set up ESLint for this project:
1. Detect project type and framework
2. Install eslint and appropriate plugins
3. Create .eslintrc configuration
4. Add lint scripts to package.json
5. Create .eslintignore`,

      prettier: `Set up Prettier for this project:
1. Install prettier
2. Create .prettierrc with sensible defaults
3. Create .prettierignore
4. Add format scripts to package.json
5. Integrate with ESLint if present`,

      testing: `Set up testing for this project:
1. Detect framework and recommend testing library
2. Install testing dependencies
3. Create test configuration file
4. Add test scripts to package.json
5. Create example test file`,

      ci: `Set up CI/CD for this project:
1. Detect project type and package manager
2. Create GitHub Actions workflow (.github/workflows/ci.yml)
3. Include lint, test, and build steps
4. Add caching for dependencies`,

      docker: `Set up Docker for this project:
1. Create Dockerfile with multi-stage build
2. Create .dockerignore
3. Create docker-compose.yml if needed
4. Add appropriate base image for project type`,
    };

    if (setups[tool]) {
      return setups[tool];
    }

    return `Unknown setup: "${tool}". Available: typescript, eslint, prettier, testing, ci, docker`;
  },
};

// Register all workflow commands
export function registerWorkflowCommands(): void {
  registerCommand(newCommand);
  registerCommand(scaffoldCommand);
  registerCommand(migrateCommand);
  registerCommand(debugCommand);
  registerCommand(setupCommand);
}
