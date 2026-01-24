// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for tools using MockProvider with file-based responses.
 *
 * These tests verify that tools execute correctly when triggered by AI responses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  setupMockE2E,
  cleanupMockE2E,
  textResponse,
  toolResponse,
  toolCall,
  conversationSequence,
  type MockE2ESession,
} from './helpers/mock-e2e.js';
import { ProcessHarness, TEST_TIMEOUT, distEntry } from './helpers/process-harness.js';

// Set longer timeout for E2E tests
vi.setConfig({ testTimeout: TEST_TIMEOUT });

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-tool-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('read_file tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create a test file to read
    fs.writeFileSync(path.join(projectDir, 'test.txt'), 'Hello, this is test content!\nLine 2 of the file.');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should read a file when AI calls read_file tool', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('read_file', { path: path.join(projectDir, 'test.txt') })]),
      textResponse('The file contains test content with two lines.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Read the test.txt file');

    // Should show file was read and AI responds with analysis
    await proc.waitFor(/test content|two lines/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('glob tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create test files to glob
    fs.writeFileSync(path.join(projectDir, 'file1.ts'), 'const a = 1;');
    fs.writeFileSync(path.join(projectDir, 'file2.ts'), 'const b = 2;');
    fs.mkdirSync(path.join(projectDir, 'src'));
    fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export {};');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should find files matching glob pattern', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('glob', { pattern: '**/*.ts', cwd: projectDir })]),
      textResponse('Found 3 TypeScript files in the project.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Find all TypeScript files');

    // Should show glob results and AI analysis
    await proc.waitFor(/TypeScript files|3.*files/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('grep tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create test files with searchable content
    fs.writeFileSync(path.join(projectDir, 'app.ts'), 'function greet() { console.log("hello"); }');
    fs.writeFileSync(path.join(projectDir, 'utils.ts'), 'export function helper() { return "hello world"; }');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should search files for pattern', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('grep', { pattern: 'hello', path: projectDir })]),
      textResponse('Found "hello" in 2 files: app.ts and utils.ts.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Search for hello in the codebase');

    // Should show grep results
    await proc.waitFor(/hello|2 files|app\.ts|utils\.ts/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('list_directory tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create test directory structure
    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(projectDir, 'file2.txt'), 'content2');
    fs.mkdirSync(path.join(projectDir, 'subdir'));
    fs.writeFileSync(path.join(projectDir, 'subdir', 'nested.txt'), 'nested content');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list directory contents', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('list_directory', { path: projectDir })]),
      textResponse('The directory contains 2 text files and 1 subdirectory.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('List the contents of the current directory');

    // Should show directory listing
    await proc.waitFor(/2 text files|subdirectory|file1|file2|subdir/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('write_file tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should write a new file', async () => {
    const newFilePath = path.join(projectDir, 'newfile.txt');
    const fileContent = 'This is new content created by the AI.';

    mockSession = setupMockE2E([
      toolResponse([toolCall('write_file', { path: newFilePath, content: fileContent })]),
      textResponse('Created newfile.txt with the requested content.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Create a new file called newfile.txt');

    // Should show file was created
    await proc.waitFor(/Created|newfile\.txt/i, 15000);

    // Verify file was actually created
    await new Promise(r => setTimeout(r, 200));
    expect(fs.existsSync(newFilePath)).toBe(true);
    expect(fs.readFileSync(newFilePath, 'utf-8')).toBe(fileContent);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('edit_file tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create a file to edit
    fs.writeFileSync(path.join(projectDir, 'config.json'), '{\n  "name": "old-name"\n}');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should edit an existing file', async () => {
    const filePath = path.join(projectDir, 'config.json');

    mockSession = setupMockE2E([
      toolResponse([toolCall('edit_file', {
        path: filePath,
        old_string: '"name": "old-name"',
        new_string: '"name": "new-name"',
      })]),
      textResponse('Updated the name in config.json from old-name to new-name.'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Change the name in config.json to new-name');

    // Should show file was edited
    await proc.waitFor(/Updated|new-name|config\.json/i, 15000);

    // Verify file was actually edited
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('"name": "new-name"');
    expect(content).not.toContain('"name": "old-name"');

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('bash tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should execute a bash command', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('bash', { command: 'echo "hello from bash"' })]),
      textResponse('The command output was: hello from bash'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Run echo hello from bash');

    // Should show command output
    await proc.waitFor(/hello from bash/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('Multi-tool conversation E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Create a file to read and potentially modify
    fs.writeFileSync(path.join(projectDir, 'app.ts'), `
export function hello() {
  return "Hello, World!";
}
`);
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should handle multiple tool calls in sequence', async () => {
    const appPath = path.join(projectDir, 'app.ts');

    // Simulate: glob -> read_file -> edit_file
    mockSession = setupMockE2E([
      // First: AI finds files
      toolResponse([toolCall('glob', { pattern: '*.ts', cwd: projectDir })]),
      // Second: AI reads the file it found
      toolResponse([toolCall('read_file', { path: appPath })]),
      // Third: AI edits the file
      toolResponse([toolCall('edit_file', {
        path: appPath,
        old_string: 'Hello, World!',
        new_string: 'Hello, Universe!',
      })]),
      // Finally: AI confirms the changes
      textResponse('I found app.ts, read it, and updated the greeting from "Hello, World!" to "Hello, Universe!".'),
    ], { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Find a TypeScript file and change World to Universe');

    // Should show final result
    await proc.waitFor(/Universe|updated|greeting/i, 20000);

    // Verify file was actually edited
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(appPath, 'utf-8');
    expect(content).toContain('Hello, Universe!');
    expect(content).not.toContain('Hello, World!');

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('conversationSequence helper E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'readme.md'), '# My Project\n\nThis is a readme file.');
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should work with conversationSequence helper', async () => {
    const responses = conversationSequence([
      { ai: 'Let me read the readme file for you.' },
      { tool: 'read_file', input: { path: path.join(projectDir, 'readme.md') } },
      { ai: 'The readme file contains a project description with a title "My Project".' },
    ]);

    mockSession = setupMockE2E(responses, { enableLogging: true });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('What does the readme say?');

    // Should show AI's analysis
    await proc.waitFor(/My Project|readme|project description/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
