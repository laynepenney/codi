import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProject, formatProjectContext } from '../src/context.js';

describe('Context Detection', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `.codi-context-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('detectProject', () => {
    it('returns null when no project files found', async () => {
      const result = await detectProject(testDir);
      expect(result).toBeNull();
    });

    describe('Node.js projects', () => {
      it('detects basic Node.js project', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'test-project',
        }));

        const result = await detectProject(testDir);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('node');
        expect(result?.name).toBe('test-project');
        expect(result?.language).toBe('JavaScript');
      });

      it('detects TypeScript project', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'ts-project',
          devDependencies: { typescript: '^5.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.language).toBe('TypeScript');
      });

      it('detects TypeScript project with tsconfig', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'ts-project',
        }));
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');

        const result = await detectProject(testDir);
        expect(result?.language).toBe('TypeScript');
      });

      it('detects Next.js framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'next-app',
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Next.js');
      });

      it('detects React framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'react-app',
          dependencies: { react: '^18.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('React');
      });

      it('detects Vue framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'vue-app',
          dependencies: { vue: '^3.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Vue');
      });

      it('detects Angular framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'angular-app',
          dependencies: { '@angular/core': '^17.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Angular');
      });

      it('detects Express framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'express-app',
          dependencies: { express: '^4.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Express');
      });

      it('detects Fastify framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'fastify-app',
          dependencies: { fastify: '^4.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Fastify');
      });

      it('detects NestJS framework', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'nest-app',
          dependencies: { nest: '^10.0.0' },
        }));

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('NestJS');
      });

      it('finds main entry files', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
          name: 'test-project',
          main: 'dist/index.js',
        }));
        mkdirSync(join(testDir, 'src'));
        writeFileSync(join(testDir, 'src', 'index.ts'), '');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('src/index.ts');
      });

      it('uses directory name when package name missing', async () => {
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));

        const result = await detectProject(testDir);
        expect(result?.name).toBeTruthy();
      });
    });

    describe('Python projects', () => {
      it('detects project with requirements.txt', async () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'requests==2.28.0\n');

        const result = await detectProject(testDir);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('python');
        expect(result?.language).toBe('Python');
      });

      it('detects project with pyproject.toml', async () => {
        writeFileSync(join(testDir, 'pyproject.toml'), '[project]\nname = "myproject"\n');

        const result = await detectProject(testDir);
        expect(result?.type).toBe('python');
      });

      it('detects project with setup.py', async () => {
        writeFileSync(join(testDir, 'setup.py'), 'from setuptools import setup\n');

        const result = await detectProject(testDir);
        expect(result?.type).toBe('python');
      });

      it('detects Django framework', async () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'django==4.2.0\n');

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Django');
      });

      it('detects Flask framework', async () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'flask==2.3.0\n');

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('Flask');
      });

      it('detects FastAPI framework', async () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'fastapi==0.100.0\n');

        const result = await detectProject(testDir);
        expect(result?.framework).toBe('FastAPI');
      });

      it('finds main entry files', async () => {
        writeFileSync(join(testDir, 'requirements.txt'), '');
        writeFileSync(join(testDir, 'main.py'), '');
        writeFileSync(join(testDir, 'app.py'), '');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('main.py');
        expect(result?.mainFiles).toContain('app.py');
      });
    });

    describe('Rust projects', () => {
      it('detects Rust project with Cargo.toml', async () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "my-rust-app"\nversion = "0.1.0"\n');

        const result = await detectProject(testDir);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('rust');
        expect(result?.name).toBe('my-rust-app');
        expect(result?.language).toBe('Rust');
      });

      it('finds src/main.rs entry file', async () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "rust-app"\n');
        mkdirSync(join(testDir, 'src'));
        writeFileSync(join(testDir, 'src', 'main.rs'), 'fn main() {}');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('src/main.rs');
      });

      it('finds src/lib.rs entry file', async () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "rust-lib"\n');
        mkdirSync(join(testDir, 'src'));
        writeFileSync(join(testDir, 'src', 'lib.rs'), 'pub fn hello() {}');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('src/lib.rs');
      });

      it('uses directory name when package name not found', async () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nversion = "0.1.0"\n');

        const result = await detectProject(testDir);
        expect(result?.name).toBeTruthy();
      });
    });

    describe('Go projects', () => {
      it('detects Go project with go.mod', async () => {
        writeFileSync(join(testDir, 'go.mod'), 'module github.com/user/myapp\n\ngo 1.21\n');

        const result = await detectProject(testDir);
        expect(result).not.toBeNull();
        expect(result?.type).toBe('go');
        expect(result?.name).toBe('github.com/user/myapp');
        expect(result?.language).toBe('Go');
      });

      it('finds main.go entry file', async () => {
        writeFileSync(join(testDir, 'go.mod'), 'module myapp\n');
        writeFileSync(join(testDir, 'main.go'), 'package main');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('main.go');
      });

      it('finds cmd/main.go entry file', async () => {
        writeFileSync(join(testDir, 'go.mod'), 'module myapp\n');
        mkdirSync(join(testDir, 'cmd'));
        writeFileSync(join(testDir, 'cmd', 'main.go'), 'package main');

        const result = await detectProject(testDir);
        expect(result?.mainFiles).toContain('cmd/main.go');
      });

      it('uses directory name when module not found', async () => {
        writeFileSync(join(testDir, 'go.mod'), 'go 1.21\n');

        const result = await detectProject(testDir);
        expect(result?.name).toBeTruthy();
      });
    });
  });

  describe('formatProjectContext', () => {
    it('formats basic project info', () => {
      const info = {
        type: 'node' as const,
        name: 'my-app',
        language: 'TypeScript',
        rootPath: '/path/to/app',
        mainFiles: [],
      };

      const result = formatProjectContext(info);
      expect(result).toContain('Project: my-app');
      expect(result).toContain('Type: TypeScript');
    });

    it('includes framework when present', () => {
      const info = {
        type: 'node' as const,
        name: 'next-app',
        language: 'TypeScript',
        framework: 'Next.js',
        rootPath: '/path/to/app',
        mainFiles: [],
      };

      const result = formatProjectContext(info);
      expect(result).toContain('(Next.js)');
    });

    it('includes entry points when present', () => {
      const info = {
        type: 'node' as const,
        name: 'my-app',
        language: 'JavaScript',
        rootPath: '/path/to/app',
        mainFiles: ['src/index.js', 'src/app.js'],
      };

      const result = formatProjectContext(info);
      expect(result).toContain('Entry points: src/index.js, src/app.js');
    });

    it('omits entry points when empty', () => {
      const info = {
        type: 'node' as const,
        name: 'my-app',
        language: 'JavaScript',
        rootPath: '/path/to/app',
        mainFiles: [],
      };

      const result = formatProjectContext(info);
      expect(result).not.toContain('Entry points');
    });
  });
});
