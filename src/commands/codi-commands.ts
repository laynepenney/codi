// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * CODI.md management commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { detectProject } from '../context.js';

/**
 * Analyze codebase and generate comprehensive CODI.md content.
 */
async function analyzeAndGenerateContext(rootPath: string): Promise<string> {
  const projectInfo = await detectProject(rootPath);
  const projectName = projectInfo?.name || basename(rootPath);

  const sections: string[] = [];

  // Header
  sections.push(`# ${projectName} - AI Assistant Context

This file provides context for AI assistants working on this codebase.
Codi automatically injects this into the system prompt.
`);

  // Project Overview
  sections.push(`## Project Overview
`);

  if (projectInfo) {
    const details: string[] = [];
    details.push(`**Type:** ${projectInfo.type}`);
    if (projectInfo.language) details.push(`**Language:** ${projectInfo.language}`);
    if (projectInfo.framework) details.push(`**Framework:** ${projectInfo.framework}`);

    sections.push(details.join('\n') + '\n');

    // Try to get description from package.json
    const pkgPath = join(rootPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.description) {
          sections.push(`${pkg.description}\n`);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Quick Reference - extract from package.json scripts
  const scripts = getPackageScripts(rootPath);
  if (scripts.length > 0) {
    sections.push(`## Quick Reference

\`\`\`bash
${scripts.map(s => `${s.cmd.padEnd(20)} # ${s.desc}`).join('\n')}
\`\`\`
`);
  }

  // Architecture Overview - directory structure
  const structure = getDirectoryStructure(rootPath);
  if (structure) {
    sections.push(`## Architecture Overview

\`\`\`
${structure}
\`\`\`
`);
  }

  // Key Files
  const keyFiles = findKeyFiles(rootPath, projectInfo?.type);
  if (keyFiles.length > 0) {
    sections.push(`## Key Files

| File | Purpose |
|------|---------|
${keyFiles.map(f => `| \`${f.path}\` | ${f.purpose} |`).join('\n')}
`);
  }

  // Dependencies (top ones)
  const deps = getTopDependencies(rootPath);
  if (deps.length > 0) {
    sections.push(`## Dependencies

Key dependencies:
${deps.map(d => `- **${d.name}**: ${d.purpose}`).join('\n')}
`);
  }

  // Coding Conventions
  sections.push(`## Coding Conventions

<!-- Review and customize these based on your project -->
`);

  if (projectInfo?.language === 'TypeScript') {
    sections.push(`- Use TypeScript strict mode
- Prefer \`async/await\` over callbacks
- Use ES modules (\`.js\` extension in imports)
`);
  } else if (projectInfo?.type === 'python') {
    sections.push(`- Follow PEP 8 style guide
- Use type hints where possible
- Prefer \`async/await\` for I/O operations
`);
  } else {
    sections.push(`- Follow project's existing code style
- Add appropriate error handling
`);
  }

  // Testing
  const testInfo = detectTestFramework(rootPath);
  if (testInfo) {
    sections.push(`## Testing

**Framework:** ${testInfo.framework}
**Test directory:** \`${testInfo.directory}\`

\`\`\`bash
${testInfo.command}
\`\`\`
`);
  }

  // Important Notes
  sections.push(`## Important Notes

<!-- Add any critical information the AI should know -->
<!-- Examples: -->
<!-- - Never modify files in the /vendor directory -->
<!-- - Always run tests before committing -->
<!-- - Database migrations require special handling -->
`);

  return sections.join('\n');
}

/**
 * Get npm scripts formatted for display.
 */
function getPackageScripts(rootPath: string): Array<{ cmd: string; desc: string }> {
  const pkgPath = join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};

    // Map common scripts to descriptions
    const scriptDescriptions: Record<string, string> = {
      dev: 'Development mode',
      start: 'Start the application',
      build: 'Build for production',
      test: 'Run tests',
      'test:watch': 'Run tests in watch mode',
      lint: 'Run linter',
      format: 'Format code',
      typecheck: 'Type checking',
      clean: 'Clean build artifacts',
      prepare: 'Prepare/setup',
    };

    const result: Array<{ cmd: string; desc: string }> = [];
    const pmCmd = existsSync(join(rootPath, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(rootPath, 'yarn.lock'))
        ? 'yarn'
        : 'npm run';

    for (const [name, _script] of Object.entries(scripts)) {
      const desc = scriptDescriptions[name] || name.replace(/[-:]/g, ' ');
      result.push({ cmd: `${pmCmd} ${name}`, desc });

      // Limit to most important scripts
      if (result.length >= 8) break;
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Get a simplified directory structure.
 */
function getDirectoryStructure(rootPath: string): string | null {
  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '.venv',
    'venv',
    'target',
    'coverage',
    '.cache',
  ]);

  const lines: string[] = [];

  function walk(dir: string, prefix: string = '', depth: number = 0): void {
    if (depth > 2) return; // Limit depth

    try {
      const entries = readdirSync(dir)
        .filter(e => !e.startsWith('.') || e === '.env.example')
        .filter(e => !ignoreDirs.has(e))
        .sort((a, b) => {
          // Directories first
          const aIsDir = statSync(join(dir, a)).isDirectory();
          const bIsDir = statSync(join(dir, b)).isDirectory();
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
          return a.localeCompare(b);
        });

      for (let i = 0; i < entries.length && lines.length < 25; i++) {
        const entry = entries[i];
        const fullPath = join(dir, entry);
        const isDir = statSync(fullPath).isDirectory();
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';

        lines.push(`${prefix}${connector}${entry}${isDir ? '/' : ''}`);

        if (isDir) {
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          walk(fullPath, newPrefix, depth + 1);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  lines.push(basename(rootPath) + '/');
  walk(rootPath);

  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Find key files in the project.
 */
function findKeyFiles(
  rootPath: string,
  projectType?: string
): Array<{ path: string; purpose: string }> {
  const keyFiles: Array<{ path: string; purpose: string }> = [];

  const filePatterns: Array<{ pattern: string; purpose: string }> = [
    { pattern: 'src/index.ts', purpose: 'Main entry point' },
    { pattern: 'src/index.js', purpose: 'Main entry point' },
    { pattern: 'src/main.ts', purpose: 'Main entry point' },
    { pattern: 'src/app.ts', purpose: 'Application setup' },
    { pattern: 'src/app.tsx', purpose: 'React app component' },
    { pattern: 'src/App.tsx', purpose: 'React app component' },
    { pattern: 'main.py', purpose: 'Main entry point' },
    { pattern: 'app.py', purpose: 'Application entry' },
    { pattern: 'package.json', purpose: 'Package configuration' },
    { pattern: 'tsconfig.json', purpose: 'TypeScript configuration' },
    { pattern: 'pyproject.toml', purpose: 'Python project configuration' },
    { pattern: 'Cargo.toml', purpose: 'Rust package configuration' },
    { pattern: 'go.mod', purpose: 'Go module definition' },
    { pattern: '.env.example', purpose: 'Environment template' },
    { pattern: 'docker-compose.yml', purpose: 'Docker services' },
    { pattern: 'Dockerfile', purpose: 'Container build' },
  ];

  for (const { pattern, purpose } of filePatterns) {
    if (existsSync(join(rootPath, pattern))) {
      keyFiles.push({ path: pattern, purpose });
    }
    if (keyFiles.length >= 10) break;
  }

  // Look for config directory
  const configDir = join(rootPath, 'src', 'config');
  if (existsSync(configDir)) {
    keyFiles.push({ path: 'src/config/', purpose: 'Configuration modules' });
  }

  return keyFiles;
}

/**
 * Get top dependencies with inferred purposes.
 */
function getTopDependencies(rootPath: string): Array<{ name: string; purpose: string }> {
  const pkgPath = join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = pkg.dependencies || {};

    const knownPurposes: Record<string, string> = {
      react: 'UI framework',
      vue: 'UI framework',
      angular: 'UI framework',
      next: 'React framework with SSR',
      express: 'HTTP server',
      fastify: 'HTTP server',
      typescript: 'Type checking',
      vitest: 'Testing framework',
      jest: 'Testing framework',
      mocha: 'Testing framework',
      prisma: 'Database ORM',
      mongoose: 'MongoDB ODM',
      axios: 'HTTP client',
      zod: 'Schema validation',
      lodash: 'Utility functions',
      chalk: 'Terminal styling',
      commander: 'CLI framework',
    };

    const result: Array<{ name: string; purpose: string }> = [];
    for (const name of Object.keys(deps)) {
      const purpose = knownPurposes[name];
      if (purpose) {
        result.push({ name, purpose });
      }
      if (result.length >= 6) break;
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Detect test framework and configuration.
 */
function detectTestFramework(
  rootPath: string
): { framework: string; directory: string; command: string } | null {
  const pkgPath = join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};

    if (deps['vitest']) {
      return {
        framework: 'Vitest',
        directory: existsSync(join(rootPath, 'tests')) ? 'tests/' : 'src/',
        command: scripts['test'] || 'pnpm test',
      };
    }
    if (deps['jest']) {
      return {
        framework: 'Jest',
        directory: existsSync(join(rootPath, '__tests__')) ? '__tests__/' : 'src/',
        command: scripts['test'] || 'npm test',
      };
    }
    if (deps['mocha']) {
      return {
        framework: 'Mocha',
        directory: 'test/',
        command: scripts['test'] || 'npm test',
      };
    }
  } catch {
    // Ignore
  }

  // Check for pytest
  if (
    existsSync(join(rootPath, 'pytest.ini')) ||
    existsSync(join(rootPath, 'pyproject.toml'))
  ) {
    return {
      framework: 'pytest',
      directory: 'tests/',
      command: 'pytest',
    };
  }

  return null;
}

/**
 * /codi command - Manage CODI.md context file.
 */
export const codiCommand: Command = {
  name: 'codi',
  aliases: ['context'],
  description: 'Manage CODI.md project context file',
  usage: '/codi [generate|show|edit]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim().toLowerCase();
    const rootPath = process.cwd();

    // Handle help flag
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /codi [generate|show|edit]');
      console.log('\nManage the CODI.md project context file.');
      console.log('\nSubcommands:');
      console.log('  generate    Analyze codebase and generate/update CODI.md');
      console.log('  show        Display current CODI.md contents');
      console.log('  edit        Open CODI.md for editing (shows AI prompt)');
      console.log('\nExamples:');
      console.log('  /codi generate   Analyze project and create CODI.md');
      console.log('  /codi show       Display current context file');
      console.log();
      return null;
    }

    // Generate command
    if (trimmed === 'generate' || trimmed === 'gen') {
      const codiPath = join(rootPath, 'CODI.md');
      const exists = existsSync(codiPath);

      console.log('\nAnalyzing codebase...');
      const content = await analyzeAndGenerateContext(rootPath);

      writeFileSync(codiPath, content);

      if (exists) {
        console.log(`\n✓ Updated ${codiPath}`);
      } else {
        console.log(`\n✓ Created ${codiPath}`);
      }
      console.log('\nReview and customize the generated content.');
      console.log('The file will be automatically loaded in your next Codi session.');

      return null;
    }

    // Show command
    if (trimmed === 'show' || trimmed === 'view') {
      const codiPath = join(rootPath, 'CODI.md');

      if (!existsSync(codiPath)) {
        console.log('\nNo CODI.md found. Run `/codi generate` to create one.');
        return null;
      }

      const content = readFileSync(codiPath, 'utf-8');
      console.log('\n' + content);
      return null;
    }

    // Edit command - return prompt for AI to help edit
    if (trimmed === 'edit') {
      const codiPath = join(rootPath, 'CODI.md');

      if (!existsSync(codiPath)) {
        return 'No CODI.md found. Please run `/codi generate` first to create the context file, then I can help you edit it.';
      }

      const content = readFileSync(codiPath, 'utf-8');
      return `Here is the current CODI.md file. Please help me review and improve it:\n\n\`\`\`markdown\n${content}\n\`\`\`\n\nSuggest improvements based on the codebase structure and best practices for AI context files.`;
    }

    // Default - show help
    console.log('\nUsage: /codi [generate|show|edit]');
    console.log('Run `/codi --help` for more information.');
    return null;
  },
};

/**
 * Register codi commands.
 */
export function registerCodiCommands(): void {
  registerCommand(codiCommand);
}
