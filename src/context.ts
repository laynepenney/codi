// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { ProjectInfo } from './commands/index.js';

/**
 * Detect project type and gather context from the current directory.
 */
export async function detectProject(rootPath: string = process.cwd()): Promise<ProjectInfo | null> {
  // Check for Node.js project
  const packageJsonPath = join(rootPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    return await detectNodeProject(rootPath, packageJsonPath);
  }

  // Check for Python project
  const pyprojectPath = join(rootPath, 'pyproject.toml');
  const requirementsPath = join(rootPath, 'requirements.txt');
  const setupPyPath = join(rootPath, 'setup.py');
  if (existsSync(pyprojectPath) || existsSync(requirementsPath) || existsSync(setupPyPath)) {
    return detectPythonProject(rootPath);
  }

  // Check for Rust project
  const cargoPath = join(rootPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    return await detectRustProject(rootPath, cargoPath);
  }

  // Check for Go project
  const goModPath = join(rootPath, 'go.mod');
  if (existsSync(goModPath)) {
    return await detectGoProject(rootPath, goModPath);
  }

  return null;
}

async function detectNodeProject(rootPath: string, packageJsonPath: string): Promise<ProjectInfo> {
  const content = await readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  // Detect framework
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let framework: string | undefined;

  if (deps['next']) framework = 'Next.js';
  else if (deps['react']) framework = 'React';
  else if (deps['vue']) framework = 'Vue';
  else if (deps['@angular/core']) framework = 'Angular';
  else if (deps['express']) framework = 'Express';
  else if (deps['fastify']) framework = 'Fastify';
  else if (deps['nest']) framework = 'NestJS';

  // Detect language
  const isTypeScript = existsSync(join(rootPath, 'tsconfig.json')) || deps['typescript'];

  // Find main entry files
  const mainFiles: string[] = [];
  const possibleMains = [
    pkg.main,
    'src/index.ts',
    'src/index.js',
    'index.ts',
    'index.js',
    'src/main.ts',
    'src/main.js',
    'src/app.ts',
    'src/app.js',
  ].filter(Boolean);

  for (const file of possibleMains) {
    if (existsSync(join(rootPath, file))) {
      mainFiles.push(file);
    }
  }

  return {
    type: 'node',
    name: pkg.name || basename(rootPath),
    framework,
    language: isTypeScript ? 'TypeScript' : 'JavaScript',
    rootPath,
    mainFiles,
  };
}

function detectPythonProject(rootPath: string): ProjectInfo {
  const mainFiles: string[] = [];
  const possibleMains = [
    'main.py',
    'app.py',
    'src/main.py',
    'src/app.py',
    '__main__.py',
  ];

  for (const file of possibleMains) {
    if (existsSync(join(rootPath, file))) {
      mainFiles.push(file);
    }
  }

  // Detect framework from requirements
  let framework: string | undefined;
  const requirementsPath = join(rootPath, 'requirements.txt');
  if (existsSync(requirementsPath)) {
    try {
      const content = require('fs').readFileSync(requirementsPath, 'utf-8');
      if (content.includes('django')) framework = 'Django';
      else if (content.includes('flask')) framework = 'Flask';
      else if (content.includes('fastapi')) framework = 'FastAPI';
    } catch {
      // Ignore read errors
    }
  }

  return {
    type: 'python',
    name: basename(rootPath),
    framework,
    language: 'Python',
    rootPath,
    mainFiles,
  };
}

async function detectRustProject(rootPath: string, cargoPath: string): Promise<ProjectInfo> {
  const content = await readFile(cargoPath, 'utf-8');
  const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);

  const mainFiles: string[] = [];
  if (existsSync(join(rootPath, 'src/main.rs'))) mainFiles.push('src/main.rs');
  if (existsSync(join(rootPath, 'src/lib.rs'))) mainFiles.push('src/lib.rs');

  return {
    type: 'rust',
    name: nameMatch?.[1] || basename(rootPath),
    language: 'Rust',
    rootPath,
    mainFiles,
  };
}

async function detectGoProject(rootPath: string, goModPath: string): Promise<ProjectInfo> {
  const content = await readFile(goModPath, 'utf-8');
  const moduleMatch = content.match(/module\s+(\S+)/);

  const mainFiles: string[] = [];
  if (existsSync(join(rootPath, 'main.go'))) mainFiles.push('main.go');
  if (existsSync(join(rootPath, 'cmd/main.go'))) mainFiles.push('cmd/main.go');

  return {
    type: 'go',
    name: moduleMatch?.[1] || basename(rootPath),
    language: 'Go',
    rootPath,
    mainFiles,
  };
}

/**
 * Generate a context summary for the AI.
 */
export function formatProjectContext(info: ProjectInfo): string {
  let context = `Project: ${info.name}\n`;
  context += `Type: ${info.language}`;
  if (info.framework) {
    context += ` (${info.framework})`;
  }
  context += '\n';

  if (info.mainFiles.length > 0) {
    context += `Entry points: ${info.mainFiles.join(', ')}\n`;
  }

  return context;
}

/**
 * Context file candidates in priority order.
 * Similar to Claude Code's CLAUDE.md, Codi looks for CODI.md.
 */
const CONTEXT_FILE_CANDIDATES = [
  'CODI.md',
  '.codi/CODI.md',
  '.codi/context.md',
];

/**
 * Load project context from a CODI.md file.
 * Searches for context files in priority order.
 *
 * @param rootPath - Project root directory (defaults to cwd)
 * @returns Object with content and path if found, nulls otherwise
 */
export function loadContextFile(rootPath: string = process.cwd()): {
  content: string | null;
  path: string | null;
} {
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    const fullPath = join(rootPath, candidate);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        return { content, path: fullPath };
      } catch {
        // Try next candidate
        continue;
      }
    }
  }

  return { content: null, path: null };
}

/**
 * Default template for CODI.md context file.
 */
function getDefaultContextTemplate(projectName: string): string {
  return `# ${projectName} - AI Assistant Context

This file provides context for AI assistants working on this codebase.
Codi automatically injects this into the system prompt.

## Project Overview

<!-- Describe your project's purpose and architecture -->

## Quick Reference

\`\`\`bash
# Common commands
# pnpm dev        # Development mode
# pnpm build      # Build for production
# pnpm test       # Run tests
\`\`\`

## Key Files

| File | Purpose |
|------|---------|
| \`src/index.ts\` | Entry point |

## Coding Conventions

<!-- Add project-specific guidelines -->
- Use TypeScript strict mode
- Prefer async/await over callbacks

## Important Notes

<!-- Add any critical information the AI should know -->
`;
}

/**
 * Initialize a CODI.md file in the current directory.
 */
export function initContextFile(cwd: string = process.cwd()): {
  success: boolean;
  path: string;
  error?: string;
} {
  const contextPath = join(cwd, 'CODI.md');

  if (existsSync(contextPath)) {
    return {
      success: false,
      path: contextPath,
      error: 'Context file already exists',
    };
  }

  // Try to get project name from package.json or directory name
  let projectName = basename(cwd);
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) projectName = pkg.name;
    }
  } catch {
    // Use directory name as fallback
  }

  try {
    writeFileSync(contextPath, getDefaultContextTemplate(projectName));
    return { success: true, path: contextPath };
  } catch (error) {
    return {
      success: false,
      path: contextPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
