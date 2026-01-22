// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPathWithinProject,
  validateAndResolvePath,
  addAllowedDirectory,
  removeAllowedDirectory,
  clearAllowedDirectories,
} from '../src/utils/path-validation.js';
import { resolve, sep } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('path-validation', () => {
  const projectRoot = process.cwd();

  describe('isPathWithinProject', () => {
    it('should return true for the project root itself', () => {
      expect(isPathWithinProject(projectRoot, projectRoot)).toBe(true);
    });

    it('should return true for a path inside the project', () => {
      const insidePath = resolve(projectRoot, 'src', 'index.ts');
      expect(isPathWithinProject(insidePath, projectRoot)).toBe(true);
    });

    it('should return true for deeply nested paths', () => {
      const deepPath = resolve(projectRoot, 'src', 'tools', 'nested', 'deep', 'file.ts');
      expect(isPathWithinProject(deepPath, projectRoot)).toBe(true);
    });

    it('should return false for paths outside the project', () => {
      const outsidePath = resolve(projectRoot, '..', 'other-project', 'file.ts');
      expect(isPathWithinProject(outsidePath, projectRoot)).toBe(false);
    });

    it('should return false for parent directory', () => {
      const parentPath = resolve(projectRoot, '..');
      expect(isPathWithinProject(parentPath, projectRoot)).toBe(false);
    });

    it('should return false for root directory', () => {
      expect(isPathWithinProject('/', projectRoot)).toBe(false);
    });

    it('should return false for path traversal attempts', () => {
      // ../../etc/passwd style attack
      const maliciousPath = resolve(projectRoot, '..', '..', 'etc', 'passwd');
      expect(isPathWithinProject(maliciousPath, projectRoot)).toBe(false);
    });

    it('should return false for sibling directories', () => {
      const siblingPath = resolve(projectRoot, '..', 'sibling-project');
      expect(isPathWithinProject(siblingPath, projectRoot)).toBe(false);
    });

    it('should handle paths with similar prefixes correctly', () => {
      // Edge case: /project vs /project-backup
      // If project is /foo/bar, /foo/bar-backup should NOT be within project
      const projectWithSuffix = projectRoot + '-backup' + sep + 'file.ts';
      expect(isPathWithinProject(projectWithSuffix, projectRoot)).toBe(false);
    });
  });

  describe('validateAndResolvePath', () => {
    it('should return resolved path for valid relative paths', () => {
      const result = validateAndResolvePath('src/index.ts', projectRoot);
      expect(result).toBe(resolve(projectRoot, 'src', 'index.ts'));
    });

    it('should return resolved path for valid absolute paths within project', () => {
      const absolutePath = resolve(projectRoot, 'src', 'utils', 'helper.ts');
      const result = validateAndResolvePath(absolutePath, projectRoot);
      expect(result).toBe(absolutePath);
    });

    it('should throw error for paths outside project directory', () => {
      expect(() => {
        validateAndResolvePath('../other-project/file.ts', projectRoot);
      }).toThrow('Security error');
      expect(() => {
        validateAndResolvePath('../other-project/file.ts', projectRoot);
      }).toThrow('resolves outside the project directory');
    });

    it('should throw error for path traversal attacks', () => {
      expect(() => {
        validateAndResolvePath('../../etc/passwd', projectRoot);
      }).toThrow('Security error');
    });

    it('should throw error for absolute paths outside project', () => {
      expect(() => {
        validateAndResolvePath('/etc/passwd', projectRoot);
      }).toThrow('Security error');
    });

    it('should handle current directory reference', () => {
      const result = validateAndResolvePath('.', projectRoot);
      expect(result).toBe(projectRoot);
    });

    it('should handle dot-prefixed relative paths', () => {
      const result = validateAndResolvePath('./src/index.ts', projectRoot);
      expect(result).toBe(resolve(projectRoot, 'src', 'index.ts'));
    });

    it('should use process.cwd() as default project root', () => {
      // This relies on process.cwd() being the project root in tests
      const result = validateAndResolvePath('src/index.ts');
      expect(result).toBe(resolve(process.cwd(), 'src', 'index.ts'));
    });

    it('should include the problematic path in error message', () => {
      try {
        validateAndResolvePath('../malicious/path', projectRoot);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('../malicious/path');
      }
    });

    it('should handle symlink-like paths that resolve inside project', () => {
      // Path like ./foo/../bar should still work if it resolves inside
      const result = validateAndResolvePath('./src/../src/index.ts', projectRoot);
      expect(result).toBe(resolve(projectRoot, 'src', 'index.ts'));
    });

    it('should reject paths that try to escape and re-enter', () => {
      // Try to escape and re-enter a different directory
      const projectName = projectRoot.split(sep).pop();
      expect(() => {
        validateAndResolvePath(`../../${projectName}-evil/file.ts`, projectRoot);
      }).toThrow('Security error');
    });
  });

  describe('allowed directories', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = `${tmpdir()}/codi-path-test-${Date.now()}`;
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      clearAllowedDirectories();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should allow paths in added directories', () => {
      addAllowedDirectory(tempDir);
      const tempFile = `${tempDir}/test.txt`;
      // Should not throw
      expect(isPathWithinProject(tempFile, projectRoot)).toBe(true);
    });

    it('should reject paths in removed directories', () => {
      addAllowedDirectory(tempDir);
      removeAllowedDirectory(tempDir);
      const tempFile = `${tempDir}/test.txt`;
      expect(isPathWithinProject(tempFile, projectRoot)).toBe(false);
    });

    it('should clear all allowed directories', () => {
      addAllowedDirectory(tempDir);
      addAllowedDirectory('/another/path');
      clearAllowedDirectories();
      expect(isPathWithinProject(`${tempDir}/test.txt`, projectRoot)).toBe(false);
    });

    it('should work with validateAndResolvePath', () => {
      addAllowedDirectory(tempDir);
      // Should not throw
      expect(() => validateAndResolvePath(`${tempDir}/test.txt`, projectRoot)).not.toThrow();
    });
  });
});
