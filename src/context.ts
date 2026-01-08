import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
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
